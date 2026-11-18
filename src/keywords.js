import { CATEGORIES, METALS } from "./config.js";

const CATEGORY_PATTERNS = [
  ["mangalsutra", /mangalsutra|mangal[\s-]?sutra|मंगलसूत्र/i],
  ["nosepin", /nose[\s-]?pins?|nosepins?|nath\b|nose[\s-]?rings?|नथ/i],
  ["earring", /ear[\s-]?rings?|jhumk[ai]s?|studs?\b|झुमका|झुमकी/i],
  ["bracelet", /bracelets?/i],
  ["bangle", /bangles?|kadas?\b|kadaa\b|kangan\b|चूड़ी|कड़ा/i],
  ["pendant", /pendants?|lockets?/i],
  ["necklace", /necklaces?|\bhaar\b|\bhar\b|नेकलेस|हार/i],
  ["chain", /\bchains?\b/i],
  ["ring", /\brings?\b|anguthi|angoothi|अंगूठी/i],
  ["set", /(jewellery|jewelry|bridal|necklace|diamond|gold)[\s-]?sets?|\bsets?\b of/i],
];

const POLKI = /\bpolki\b|\bkundan\b/i;
const DIAMOND = /\bdiamonds?\b|\bsolitaire\b/i;
const GOLD = /\bgold\b|\b\d{2}\s?k(?:t|arat)?\b/i;
const OTHER_METAL = /\bplatinum\b|\bsilver\b/i;

export function guess(caption) {
  const text = caption || "";
  let category = "other";
  for (const [name, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) {
      category = name;
      break;
    }
  }
  const hits = new Set();
  if (POLKI.test(text)) hits.add("polki");
  if (DIAMOND.test(text)) hits.add("diamond");
  if (GOLD.test(text)) hits.add("gold");
  let metal;
  if (hits.has("polki") && hits.size === 1) metal = "polki";
  else if (hits.has("polki")) metal = "mixed";
  else if (hits.has("diamond")) metal = "diamond";
  else if (hits.has("gold")) metal = "gold";
  else if (OTHER_METAL.test(text)) metal = "other";
  else metal = "unknown";
  let confidence = 0.55;
  if (category === "other" && metal === "unknown") confidence = 0.15;
  else if (category === "other" || metal === "unknown") confidence = 0.4;
  if (!CATEGORIES.includes(category) || !METALS.includes(metal)) {
    throw new Error(`unexpected keyword tag ${category}/${metal}`);
  }
  return { category, metal, confidence };
}
