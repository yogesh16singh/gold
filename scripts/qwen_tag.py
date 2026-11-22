"""Tag jewellery posts and Reels with local Qwen3-VL-2B-Instruct.

Images go in as one photo. Carousel slides are tagged one by one and merged.
Reels are not sent whole: FFmpeg keeps 4 frames under 15 seconds and 8 frames
above that. A second set of frames is extracted only when the jewellery is
still unclear. The RTX 2050 has 4 GB, so the weights load in 4-bit.
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "feed.db"
BIN_DIR = ROOT / "data" / "bin"
MEDIA_DIR = ROOT / "data" / "qwen-media"
LOG_PATH = ROOT / "data" / "qwen-tags.jsonl"
MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"
HF_HOME = ROOT / "data" / "hf-cache"

CATEGORIES = [
    "ring",
    "necklace",
    "earring",
    "bangle",
    "bracelet",
    "pendant",
    "chain",
    "mangalsutra",
    "nosepin",
    "set",
    "other",
]
METALS = ["gold", "diamond", "polki", "mixed", "other", "unknown"]
CATEGORY_ALIASES = {
    "earrings": "earring",
    "rings": "ring",
    "bangles": "bangle",
    "bracelets": "bracelet",
    "necklaces": "necklace",
    "pendants": "pendant",
    "chains": "chain",
    "sets": "set",
    "nosepins": "nosepin",
    "nose pin": "nosepin",
    "nose-pin": "nosepin",
    "mangalsutras": "mangalsutra",
}
METAL_ALIASES = {"kundan": "polki", "gold and diamond": "mixed", "diamond and gold": "mixed"}


def load_env(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def normalise(value, allowed, aliases):
    text = re.sub(r"\s+", " ", str(value or "").lower().strip())
    text = aliases.get(text, text)
    return text if text in allowed else None


def keywords_of(value):
    if isinstance(value, str):
        parts = re.split(r"[,|]", value)
    elif isinstance(value, list):
        parts = value
    else:
        parts = []
    seen = []
    for part in parts:
        word = re.sub(r"\s+", " ", str(part).lower().strip(" #\"'"))
        if not word or len(word) > 40 or word in seen:
            continue
        seen.append(word)
        if len(seen) == 12:
            break
    return seen


def observation_from(data):
    if not isinstance(data, dict):
        data = {}
    category = normalise(data.get("category"), CATEGORIES, CATEGORY_ALIASES) or "other"
    metal = normalise(data.get("metal"), METALS, METAL_ALIASES) or "unknown"
    try:
        confidence = float(data.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    visible = data.get("jewellery_visible")
    if isinstance(visible, str):
        visible = visible.strip().lower() in {"true", "yes", "1"}
    if visible is None:
        visible = category != "other"
    if not visible:
        category = "other"
    if confidence < 0.4:
        category = "other"
        metal = "unknown"
    return {
        "category": category,
        "metal": metal,
        "confidence": round(confidence, 3),
        "keywords": keywords_of(data.get("keywords")),
        "jewellery_visible": bool(visible and category != "other"),
    }


def parse_tag(text):
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    if fenced:
        raw = fenced.group(1)
    else:
        found = re.search(r"\{.*\}", raw, re.S)
        if found:
            raw = found.group(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    return observation_from(data)


def merge_observations(items):
    usable = [item for item in items if item["confidence"] >= 0.4 and item["category"] != "other"]
    if not usable:
        keywords = keywords_of([word for item in items for word in item["keywords"]])
        return {
            "category": "other",
            "metal": "unknown",
            "confidence": 0.3,
            "keywords": keywords,
            "jewellery_visible": False,
        }
    counts = {}
    for item in usable:
        counts[item["category"]] = counts.get(item["category"], 0) + 1
    ranked = sorted(counts, key=lambda name: (-counts[name], name))
    winner = ranked[0]
    tied = len(ranked) > 1 and counts[ranked[1]] == counts[winner]
    if tied:
        return {
            "category": "other",
            "metal": "unknown",
            "confidence": round(sum(item["confidence"] for item in usable) / len(usable), 3),
            "keywords": keywords_of([word for item in usable for word in item["keywords"]]),
            "jewellery_visible": False,
        }
    chosen = [item for item in usable if item["category"] == winner]
    metals = [item["metal"] for item in chosen if item["metal"] not in {"other", "unknown"}]
    metal_counts = {}
    for metal in metals:
        metal_counts[metal] = metal_counts.get(metal, 0) + 1
    if "polki" in metal_counts:
        metal = "polki"
    elif "gold" in metal_counts and "diamond" in metal_counts:
        metal = "mixed"
    elif "mixed" in metal_counts and ("gold" in metal_counts or "diamond" in metal_counts):
        metal = "mixed"
    elif metal_counts:
        metal = sorted(metal_counts, key=lambda name: (-metal_counts[name], name))[0]
        top = metal_counts[metal]
        if top < len(chosen) / 2:
            metal = "unknown"
    else:
        metal = "unknown"
    confidence = sum(item["confidence"] for item in chosen) / len(chosen)
    if metal == "unknown":
        confidence = min(confidence, 0.55)
    return {
        "category": winner,
        "metal": metal,
        "confidence": round(confidence, 3),
        "keywords": keywords_of([word for item in chosen for word in item["keywords"]]),
        "jewellery_visible": True,
    }


def agree_keywords(tag):
    words = {part for keyword in tag["keywords"] for part in keyword.split()}
    if tag["category"] == "bracelet" and "bangle" in words and "bracelet" not in words:
        tag["category"] = "bangle"
    elif tag["category"] == "bangle" and "bracelet" in words and "bangle" not in words:
        tag["category"] = "bracelet"
    return tag


def unclear(tag):
    return (not tag["jewellery_visible"]) or tag["category"] == "other" or tag["metal"] == "unknown" or tag["confidence"] < 0.5


def prompt_for(caption, kind):
    caption = re.sub(r"\s+", " ", (caption or "")).strip()[:500] or "(none)"
    return "\n".join([
        "You tag Instagram jewellery for Indian gold and diamond traders.",
        "Look at the jewellery, not the clothing, the shop, or the greeting.",
        f"This input is {kind}.",
        "A Reel can change angle, show a close-up, a person wearing the piece, on-screen text, and unrelated scenes.",
        "Ignore frames that do not show the product.",
        "Return one JSON object and nothing else.",
        "Keys: category, metal, confidence, keywords, jewellery_visible.",
        f"category must be one of: {', '.join(CATEGORIES)}.",
        f"metal must be one of: {', '.join(METALS)}.",
        "Use set when more than one jewellery type is the product being sold.",
        "Use mixed when gold and diamonds are both the point. Use polki for polki or kundan.",
        "Use other for category when no jewellery product is shown.",
        "Use unknown for metal when the metal is not clear.",
        "confidence is a number from 0 to 1.",
        "keywords is an array of short searchable words for the design, colour, stone, and text printed on the jewellery. No duplicates.",
        "jewellery_visible is true only when a jewellery product is clearly shown.",
        f"Caption and hashtags, for context only: {caption}",
    ])


def self_test():
    earring = {"category": "earring", "metal": "gold", "confidence": 0.9, "keywords": ["jhumka", "Jhumka"], "jewellery_visible": True}
    other = {"category": "other", "metal": "unknown", "confidence": 0.2, "keywords": ["store"], "jewellery_visible": False}
    diamond = {"category": "earring", "metal": "diamond", "confidence": 0.8, "keywords": ["stud"], "jewellery_visible": True}
    ring = {"category": "ring", "metal": "gold", "confidence": 0.7, "keywords": ["band"], "jewellery_visible": True}
    merged = merge_observations([earring, earring, other])
    assert merged["category"] == "earring" and merged["metal"] == "gold", merged
    assert merged["keywords"] == ["jhumka"], merged
    mixed = merge_observations([earring, diamond])
    assert mixed["metal"] == "mixed", mixed
    split = merge_observations([earring, ring])
    assert split["category"] == "other" and split["jewellery_visible"] is False, split
    low = observation_from({"category": "bangles", "metal": "kundan", "confidence": 0.2, "keywords": "bridal, bridal"})
    assert low["category"] == "other" and low["metal"] == "unknown", low
    high = observation_from({"category": "bangles", "metal": "kundan", "confidence": 0.8, "keywords": ["bridal", "bridal"]})
    assert high["category"] == "bangle" and high["metal"] == "polki" and high["keywords"] == ["bridal"], high
    print("merge checks passed")


def graph_get(token, version, path, query):
    params = dict(query)
    params["access_token"] = token
    url = f"https://graph.facebook.com/{version}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        try:
            message = json.loads(body).get("error", {}).get("message", "")
        except json.JSONDecodeError:
            message = ""
        raise RuntimeError(f"Graph HTTP {error.code} {message[:180]}") from None


def media_for_brand(token, version, ig_user_id, username):
    fields = (
        "business_discovery.username("
        + username
        + "){media.limit(50){id,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}}}"
    )
    try:
        payload = graph_get(token, version, ig_user_id, {"fields": fields})
    except RuntimeError:
        fields = (
            "business_discovery.username("
            + username
            + "){media.limit(50){id,media_type,media_url,thumbnail_url}}"
        )
        payload = graph_get(token, version, ig_user_id, {"fields": fields})
    found = {}
    for item in payload.get("business_discovery", {}).get("media", {}).get("data", []):
        found[str(item.get("id"))] = item
    return found


def download(url, dest, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "gold-express"})
    with urllib.request.urlopen(request, timeout=60) as response:
        chunks = []
        size = 0
        while True:
            block = response.read(1024 * 256)
            if not block:
                break
            size += len(block)
            if size > limit:
                raise RuntimeError(f"file is over {limit} bytes")
            chunks.append(block)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"".join(chunks))
    return dest


def tool(name):
    local = BIN_DIR / name
    if local.exists():
        return str(local)
    return name


def duration_of(path):
    result = subprocess.run(
        [tool("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        return max(0.0, float(result.stdout.strip()))
    except ValueError:
        return 0.0


def sample_times(duration, count):
    if duration <= 0.4:
        return [0.0]
    start = min(0.4, duration * 0.08)
    end = max(start, duration * 0.92)
    if count <= 1:
        return [round((start + end) / 2, 3)]
    span = end - start
    return [round(start + span * index / (count - 1), 3) for index in range(count)]


def extra_times(duration, used, count):
    points = sorted(set(used))
    mids = []
    for left, right in zip(points, points[1:]):
        mids.append(round((left + right) / 2, 3))
    if duration > 0:
        mids.extend(sample_times(duration, count))
    picked = []
    for time in mids:
        if any(abs(time - previous) < 0.35 for previous in used + picked):
            continue
        picked.append(time)
        if len(picked) == count:
            break
    return picked


def extract_frames(video, times, dest):
    from PIL import Image

    dest.mkdir(parents=True, exist_ok=True)
    frames = []
    for index, time in enumerate(times):
        path = dest / f"frame-{index:02d}.jpg"
        subprocess.run(
            [
                tool("ffmpeg"), "-y", "-ss", str(time), "-i", str(video),
                "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "3", str(path),
            ],
            check=False,
            capture_output=True,
        )
        if path.exists() and path.stat().st_size > 32:
            frames.append(Image.open(path).convert("RGB"))
    return frames


def frame_budget(duration):
    return 4 if duration <= 15 else 8


def load_model():
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

    os.environ["HF_HOME"] = str(HF_HOME)
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    HF_HOME.mkdir(parents=True, exist_ok=True)
    quant = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID,
        quantization_config=quant,
        device_map="auto",
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    ).eval()
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    for holder in (getattr(processor, "image_processor", None), getattr(processor, "video_processor", None)):
        if holder is not None and hasattr(holder, "max_pixels"):
            holder.max_pixels = 256 * 28 * 28
    return model, processor


def generate(model, processor, content, text):
    import torch

    messages = [{"role": "user", "content": content + [{"type": "text", "text": text}]}]
    kwargs = {"do_sample_frames": False, "cap_pixels_per_frame": True}
    if any(part.get("type") == "video" for part in content):
        frames = next(part["video"] for part in content if part.get("type") == "video")
        seconds = float(content[0].get("seconds") or max(len(frames), 1))
        kwargs["video_metadata"] = [{
            "total_num_frames": len(frames),
            "fps": len(frames) / seconds,
            "duration": seconds,
            "frames_indices": list(range(len(frames))),
        }]
    try:
        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            processor_kwargs=kwargs,
        )
    except TypeError:
        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
    inputs = inputs.to(model.device)
    prompt_len = inputs["input_ids"].shape[1]
    try:
        with torch.inference_mode():
            output = model.generate(**inputs, max_new_tokens=180, do_sample=False)
        return processor.batch_decode(output[:, prompt_len:], skip_special_tokens=True)[0].strip()
    finally:
        del inputs
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def tag_images(model, processor, images, caption, kind):
    observations = []
    for image in images:
        text = generate(model, processor, [{"type": "image", "image": image}], prompt_for(caption, kind))
        observations.append(agree_keywords(parse_tag(text)))
    return merge_observations(observations) if len(observations) > 1 else observations[0]


def tag_frames(model, processor, frames, seconds, caption):
    content = [{"type": "video", "video": frames, "seconds": seconds}]
    text = generate(model, processor, content, prompt_for(caption, "frames sampled from one Reel"))
    return agree_keywords(parse_tag(text))


def posts_to_tag(connection, since, limit):
    sql = """
        SELECT ig_media_id, brand_username, caption, media_type, media_product_type, thumbnail_path
        FROM posts
        WHERE published_at >= ?
          AND (category IS NULL OR tag_source = 'keyword')
        ORDER BY
          CASE media_type WHEN 'IMAGE' THEN 0 WHEN 'CAROUSEL_ALBUM' THEN 1 ELSE 2 END,
          published_at DESC
    """
    rows = connection.execute(sql, (since,)).fetchall()
    if limit:
        return rows[:limit]
    return rows


def save_tag(connection, media_id, tag):
    connection.execute(
        """
        UPDATE posts
        SET category = ?, metal = ?, tag_source = 'qwen', tag_confidence = ?
        WHERE ig_media_id = ?
          AND (category IS NULL OR tag_source = 'keyword')
        """,
        (tag["category"], tag["metal"], tag["confidence"], media_id),
    )
    connection.commit()


def image_files(item, dest):
    from PIL import Image

    children = (item.get("children") or {}).get("data") or [item]
    images = []
    for index, child in enumerate(children):
        if str(child.get("media_type") or "").upper() == "VIDEO":
            continue
        url = child.get("media_url") or child.get("thumbnail_url")
        if not url:
            continue
        path = download(url, dest / f"slide-{index:02d}.jpg", 8_000_000)
        images.append(Image.open(path).convert("RGB"))
        if len(images) == 8:
            break
    return images


def local_image(row):
    from PIL import Image

    if not row["thumbnail_path"]:
        return []
    path = ROOT / row["thumbnail_path"]
    if not path.exists():
        return []
    return [Image.open(path).convert("RGB")]


def tag_post(model, processor, row, item, allow_thumbnail=False):
    media_type = (row["media_type"] or "").upper()
    work = MEDIA_DIR / row["ig_media_id"]
    if media_type == "VIDEO":
        url = (item or {}).get("media_url")
        if not url and allow_thumbnail:
            images = local_image(row)
            if not images:
                raise RuntimeError("no video url")
            tag = tag_images(model, processor, images, row["caption"], "the Reel thumbnail only")
            tag["frames"] = 1
            tag["input"] = "thumbnail"
            return tag
        if not url:
            raise RuntimeError("no video url")
        video = download(url, work / "reel.mp4", 80_000_000)
        seconds = duration_of(video)
        times = sample_times(seconds, frame_budget(seconds))
        frames = extract_frames(video, times, work / "frames")
        if not frames:
            raise RuntimeError("ffmpeg extracted no frames")
        tag = tag_frames(model, processor, frames, seconds or float(len(frames)), row["caption"])
        tag["frames"] = len(frames)
        tag["input"] = "frames"
        if unclear(tag):
            more = extra_times(seconds, times, 8)
            extra = extract_frames(video, more, work / "extra") if more else []
            if extra:
                second = tag_frames(model, processor, extra, seconds or float(len(extra)), row["caption"])
                second["frames"] = len(extra)
                tag = merge_observations([tag, second])
                tag["frames"] = len(frames) + len(extra)
                tag["input"] = "frames"
        video.unlink(missing_ok=True)
        return tag
    images = []
    if item:
        try:
            images = image_files(item, work)
        except Exception:
            images = []
    if not images:
        images = local_image(row)
    if not images:
        raise RuntimeError("no image")
    kind = "one carousel slide" if media_type == "CAROUSEL_ALBUM" else "one photo"
    tag = tag_images(model, processor, images, row["caption"], kind)
    tag["frames"] = len(images)
    tag["input"] = "slides" if media_type == "CAROUSEL_ALBUM" else "photo"
    return tag


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--compare", nargs="+", default=[])
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    env = load_env(ROOT / ".env")
    token = env.get("META_ACCESS_TOKEN", "")
    ig_user_id = env.get("IG_USER_ID", "")
    version = env.get("GRAPH_API_VERSION") or "v22.0"
    if not token or not ig_user_id:
        raise SystemExit("META_ACCESS_TOKEN and IG_USER_ID are required")
    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    comparing = bool(args.compare)
    if comparing:
        marks = ",".join("?" * len(args.compare))
        rows = connection.execute(
            f"""SELECT ig_media_id, brand_username, caption, media_type, media_product_type,
                       thumbnail_path, category, metal, tag_source
                FROM posts WHERE ig_media_id IN ({marks})""",
            args.compare,
        ).fetchall()
        print(f"comparing {len(rows)} posts, leaving the stored tags in place", flush=True)
    else:
        rows = posts_to_tag(connection, since, args.limit)
        print(f"{len(rows)} posts to tag since {since}", flush=True)
    if not rows:
        return
    print("loading Qwen3-VL-2B-Instruct in 4-bit", flush=True)
    model, processor = load_model()
    cache = {}
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    done = 0
    with LOG_PATH.open("a") as log:
        for row in rows:
            brand = row["brand_username"]
            print(f"{brand} {row['ig_media_id']} {row['media_type']}", flush=True)
            try:
                if brand not in cache:
                    cache[brand] = media_for_brand(token, version, ig_user_id, brand)
                tag = tag_post(
                    model, processor, row, cache[brand].get(row["ig_media_id"]), allow_thumbnail=comparing,
                )
            except Exception as error:
                print(f"  skipped ({error})", flush=True)
                continue
            import torch
            torch.cuda.empty_cache()
            if not comparing:
                save_tag(connection, row["ig_media_id"], tag)
            stored = f"{row['category'] or '-'}/{row['metal'] or '-'}" if comparing else ""
            same = comparing and row["category"] == tag["category"] and row["metal"] == tag["metal"]
            record = {
                "ig_media_id": row["ig_media_id"],
                "brand": brand,
                "media_type": row["media_type"],
                "stored_source": row["tag_source"] if comparing else "qwen",
                "stored_category": row["category"] if comparing else tag["category"],
                "stored_metal": row["metal"] if comparing else tag["metal"],
                "match": same if comparing else True,
                **tag,
            }
            log.write(json.dumps(record) + "\n")
            log.flush()
            done += 1
            if comparing:
                verdict = "same" if same else "different"
                print(
                    f"  stored {row['tag_source']} {stored} | qwen {tag['category']} / {tag['metal']} "
                    f"{verdict} via {tag.get('input')} frames={tag['frames']}",
                    flush=True,
                )
            else:
                print(
                    f"  {tag['category']} / {tag['metal']} {tag['confidence']} "
                    f"frames={tag['frames']} keywords={', '.join(tag['keywords'])}",
                    flush=True,
                )
    print(f"tagged {done} of {len(rows)}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
