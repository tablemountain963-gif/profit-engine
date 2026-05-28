// Trend ranking + opportunity scoring.
// Takes raw items from sources, normalizes, deduplicates, scores opportunity value.
import { hash, slugify, logger } from '../lib/util.js';
import { nicheBias } from './memory.js';

// Stopwords trimmed to high-value signal extraction.
const STOPWORDS = new Set([
  'a','an','the','of','to','in','for','on','with','at','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','should','could','may','might','can','this','that','these','those','it','its','their','there','here','we','us','our','you','your','he','she','they','them','what','when','why','how','which','who','whose','im','about','as','if','so','but','or','and','not','no','yes','also',
  'just','like','some','any','very','more','most','much','many','few','lot','little','still','really','actually','simply','basically','seems','seem','look','looking','need','needs','want','wants','make','made','makes','made','get','gets','got','getting','take','takes','took','give','gives','gave','use','uses','used','using','say','said','says','saying','tell','told','tells','put','puts','let','lets','run','runs','ran','show','shows','showed','find','found','finds','think','thinks','thought','know','knows','knew','known','feel','feels','felt','seem','seems','seemed','help','helps','helped','helping','work','works','worked','working',
  'one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','last','next','only','other','others','another','same','different','new','old',
  'time','times','day','days','week','weeks','month','months','year','years','today','tomorrow','yesterday','now','then','again','always','never','sometimes','often','also','too','either','neither','both','each','every','all','none',
  'good','bad','great','better','worse','best','worst','high','low','big','small','large',
  'thing','things','stuff','way','ways','case','cases','part','parts','person','people','someone','anyone','everyone','nobody','everybody',
  'really','actually','probably','maybe','perhaps','sure','though','although','because','since','while','unless','until','whether',
  'see','seen','saw','seeing','come','came','comes','coming','go','goes','went','going','gone',
  'thanks','thank','please','sorry','okay','ok','yeah','yep','nope','hi','hey','hello',
  'post','posts','comment','comments','submission','submissions','user','users','sub','reddit','hackernews','github','article','articles','blog','post','posts','link','links','title','titles',
  'edit','update','tldr','tl;dr','tldr;','imo','imho','afaik','fyi','etc',
  'thread','question','questions','threads','answer','answers','reply','replies','discussion','discussions','vote','upvote','downvote','karma',
  'guys','folks','everyone','someone','anyone','nobody',
  'really','very','quite','pretty','rather','fairly','almost','nearly','exactly','approximately',
  'made','make','making','built','build','building','done','doing','went','going','came','coming','goes','say','said','says',
  'looks','look','looking','seems','seem','seemed','seeming','appears','appear','appeared',
  'href','target','blank','https','http','www','com','org','net','html','span','div','class','rel','noopener','nofollow','noreferrer','src','img','alt','svg','utm','amp','cdata','rss','xml','json','php','aspx','onclick','style','width','height','px','rem','tabindex','aria','meta','link','script','iframe','nbsp','quot','apos','gt','lt',
  'font','fonts','color','colour','background','margin','padding','border','pixel','button','dropdown','checkbox','sidebar','navbar','modal','tooltip','placeholder','bold','italic','underline',
  'simple','easy','hard','quick','fast','slow','daily','weekly','monthly','yearly','annual','annually',
  'awesome','amazing','incredible','perfect','terrible','horrible','crazy','insane','interesting','useful',
  'asks','ask','asked','asking','tells','tell','told','tells','telling','wonders','wonder','wondered',
  'pretty','quite','rather','somewhat','slightly',
  'currently','recently','soon','later','earlier','already','yet','still',
  'right','wrong','correct','incorrect','true','false','sure','unsure',
]);

const COMMERCIAL_HINTS = ['buy', 'best', 'top', 'review', 'guide', 'how to', 'compare', 'vs', 'cheap', 'budget', 'deal', 'discount', 'subscription', 'tool', 'tools', 'app', 'apps', 'pricing', 'plan', 'service', 'platform', 'gear', 'kit', 'starter', 'pro', 'premium', 'free', 'trial', 'alternative', 'alternatives'];

const HIGH_VALUE_NICHES = {
  software: { weight: 1.4, words: ['software', 'saas', 'app', 'tool', 'platform', 'api', 'open source', 'self-hosted', 'cli', 'devtool', 'framework', 'library'] },
  ai: { weight: 1.6, words: ['ai', 'llm', 'gpt', 'claude', 'gemini', 'agent', 'rag', 'embedding', 'model', 'fine-tune', 'prompt'] },
  finance: { weight: 1.5, words: ['investing', 'finance', 'money', 'income', 'side hustle', 'passive', 'budget', 'crypto', 'stock', 'etf', 'dividend'] },
  productivity: { weight: 1.2, words: ['productivity', 'note-taking', 'workflow', 'automation', 'todo', 'time tracker', 'calendar'] },
  health: { weight: 1.3, words: ['fitness', 'workout', 'nutrition', 'supplement', 'protein', 'sleep', 'recovery', 'wellness'] },
  hobby: { weight: 1.0, words: ['hobby', 'craft', 'maker', '3d print', 'woodworking', 'gardening', 'photography', 'camera'] },
  gear: { weight: 1.4, words: ['gear', 'gadget', 'mechanical keyboard', 'monitor', 'desk', 'chair', 'headphone', 'speaker', 'mouse'] },
};

function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && w.length > 2 && !STOPWORDS.has(w));
}

function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function nicheBoost(text) {
  const t = text.toLowerCase();
  let bestWeight = 1.0;
  let bestNiche = 'general';
  for (const [niche, { weight, words }] of Object.entries(HIGH_VALUE_NICHES)) {
    if (words.some(w => t.includes(w)) && weight > bestWeight) {
      bestWeight = weight;
      bestNiche = niche;
    }
  }
  return { weight: bestWeight, niche: bestNiche };
}

function commercialScore(text) {
  const t = text.toLowerCase();
  let n = 0;
  for (const h of COMMERCIAL_HINTS) if (t.includes(h)) n++;
  return n;
}

function ageDecay(createdEpoch) {
  if (!createdEpoch) return 0.5;
  const ageHours = (Date.now() / 1000 - createdEpoch) / 3600;
  if (ageHours < 6) return 1.0;
  if (ageHours < 24) return 0.8;
  if (ageHours < 72) return 0.6;
  if (ageHours < 168) return 0.4;
  return 0.2;
}

// Composite score: engagement × niche weight × commercial hints × recency × historical bias.
function scoreItem(item) {
  const text = `${item.title} ${item.selftext || item.desc || ''}`;
  const { weight, niche } = nicheBoost(text);
  const commercial = commercialScore(text);
  const engagement = Math.log10(1 + (item.score || 0) + (item.comments || 0) * 2);
  const recency = ageDecay(item.created);
  const bias = nicheBias(niche); // historical performance multiplier
  const score = engagement * weight * recency * (1 + commercial * 0.15) * bias;
  return { score, niche, commercial, weight, recency, bias };
}

export function rankItems(items) {
  const enriched = items.map(it => {
    const m = scoreItem(it);
    return { ...it, _score: m.score, _niche: m.niche, _commercial: m.commercial };
  });
  enriched.sort((a, b) => b._score - a._score);
  return enriched;
}

// Extract capitalized multi-word sequences (proper nouns / named entities) from
// an original-cased title. "Anthropic OpenAI", "Product Market Fit", "Claude Code".
// These are far higher-value topics than lowercase conversational fragments.
function properPhrases(title) {
  const out = new Set();
  // Sequences of 1-4 Capitalized words (allowing internal lowercase like "of")
  const re = /\b([A-Z][a-zA-Z0-9.+]{1,}(?:\s+(?:[A-Z][a-zA-Z0-9.+]{1,}|of|the|for|and)){0,3})\b/g;
  let m;
  while ((m = re.exec(String(title)))) {
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/).filter(w => !['of', 'the', 'for', 'and'].includes(w.toLowerCase()));
    if (words.length >= 1 && words.join('').length >= 4) {
      out.add(phrase.toLowerCase());
    }
  }
  return out;
}

// Topic extraction: cluster top items by shared keyword frequency.
// Heavily favors multi-word phrases and named entities over conversational tokens.
export function extractTopics(items, topN = 10) {
  const freq = new Map();
  for (const it of items.slice(0, 200)) {
    const text = `${it.title} ${it.selftext || it.desc || ''}`;
    const tokens = tokenize(text);

    // Proper-noun phrases from the ORIGINAL-cased title (strongest signal).
    const propers = properPhrases(it.title || '');
    for (const p of propers) {
      const parts = p.split(' ');
      if (parts.some(w => STOPWORDS.has(w))) continue;
      addFreq(freq, p, it, 5, true);
    }

    const bg = bigrams(tokens).filter(b => {
      const [a, c] = b.split(' ');
      return a && c && a.length >= 3 && c.length >= 3 && !STOPWORDS.has(a) && !STOPWORDS.has(c);
    });

    // Bigrams get 3x weight; single tokens only count if niche-relevant.
    for (const phrase of bg) {
      addFreq(freq, phrase, it, 3, false);
    }
    for (const tok of tokens) {
      if (tok.length < 4 || STOPWORDS.has(tok)) continue;
      if (!isInNicheVocab(tok)) continue;
      addFreq(freq, tok, it, 1, false);
    }
  }

  const topics = [...freq.entries()]
    .filter(([k, v]) => {
      if (v.count < 2) return false;
      if (k.length < 4) return false;
      const parts = k.split(' ');
      const nonStop = parts.filter(p => !STOPWORDS.has(p));
      if (nonStop.length !== parts.length) return false;
      // Quality gate: keep only topics that are a named entity, niche-relevant,
      // or commercially intentful. Drops conversational junk ("nothing rude").
      const isProper = v.proper > 0;
      const isNiche = [...v.niches].some(n => n !== 'general') || parts.some(isInNicheVocab);
      const isCommercial = COMMERCIAL_HINTS.some(h => k.includes(h));
      return isProper || isNiche || isCommercial;
    })
    .map(([keyword, v]) => ({
      keyword,
      count: v.count,
      score: v.score * (v.proper > 0 ? 1.5 : 1),
      proper: v.proper > 0,
      niches: [...v.niches].filter(n => n !== 'general').concat([...v.niches].filter(n => n === 'general')),
      examples: v.items,
      id: hash(keyword),
      slug: slugify(keyword),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return topics;
}

function addFreq(freq, key, item, weight, isProper = false) {
  const cur = freq.get(key) || { count: 0, score: 0, items: [], niches: new Set(), proper: 0 };
  cur.count += weight;
  cur.score += (item._score || 1) * weight;
  cur.niches.add(item._niche || 'general');
  if (isProper) cur.proper += 1;
  if (cur.items.length < 5) cur.items.push({ title: item.title, url: item.url, source: item.source });
  freq.set(key, cur);
}

function isInNicheVocab(token) {
  for (const { words } of Object.values(HIGH_VALUE_NICHES)) {
    if (words.some(w => w === token || w.split(' ').includes(token))) return true;
  }
  return false;
}

export function selectOpportunities(items, count = 5) {
  const ranked = rankItems(items);
  const topics = extractTopics(ranked, 25);

  // pick high-score topics that are commercial AND niche-weighted
  const commercial = topics.filter(t => {
    const text = t.keyword;
    return COMMERCIAL_HINTS.some(h => text.includes(h)) || t.niches.some(n => n !== 'general');
  });

  const opps = (commercial.length >= count ? commercial : topics).slice(0, count);

  // attach a brief opportunity summary
  return opps.map(t => ({
    ...t,
    opportunity: classifyOpportunity(t, ranked),
  }));
}

function classifyOpportunity(topic, ranked) {
  const commercial = COMMERCIAL_HINTS.some(h => topic.keyword.includes(h));
  const aiRelated = ['ai', 'llm', 'gpt', 'claude'].some(w => topic.keyword.includes(w));
  const niche = topic.niches.find(n => n !== 'general');

  let type = 'editorial';
  if (commercial) type = 'affiliate';
  else if (aiRelated) type = 'tooling';
  else if (niche) type = 'niche-content';

  const recommended = {
    affiliate: 'Write SEO comparison/roundup article with affiliate links.',
    tooling: 'Build / list AI tools; monetize via affiliate links + lead magnet.',
    'niche-content': `Publish niche guide for "${niche}"; bundle into digital product later.`,
    editorial: 'Newsletter/trend digest piece; aggregates for top-of-funnel traffic.',
  }[type];

  return { type, recommended };
}
