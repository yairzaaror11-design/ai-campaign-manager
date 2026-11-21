'use strict';
// The professional knowledge the agent works by: how a senior media buyer builds and manages small-budget
// Meta campaigns, how ads are written and designed, and what each kind of business needs.
// Sources: reports/פערי יכולות הבוט מול השוק.md and reports/מודעות נדלן מתחרים ושיחת בוט.md
// (Meta guidance, practitioners, Israeli law). Practitioner thresholds are defaults, not Meta rules.

const MEDIA_BUYING = `MEDIA BUYING (small budgets, ₪50–₪300/day)
- Structure: one campaign, one ad set, 3–5 ads that differ in concept (not near-copies). Advantage+ audience and placements on; the location radius is the main manual setting. More ad sets on a small budget only splits learning.
- Objective: instant lead forms for "get inquiries"; click-to-WhatsApp messages when the business sells in conversation; website sales only with a working pixel. Recommend one and say why.
- Learning: about 50 results a week exit learning; "Learning limited" on a small budget is normal, not a failure. Changing targeting, creative, optimization event, adding an ad or pausing 7+ days restarts learning: batch changes, never tweak daily.
- Judge after enough data: wait 48–72 hours after launch and judge ads on 7-day windows. Pause an ad that spent about 2× the target cost per lead with no lead. Scale a winner gradually and only after a stable week. Frequency above ~4 or falling click rate means refresh the creative.
- Forms: short (name, phone, one or two qualifying questions). Prefer "higher intent" when lead quality matters. A privacy-policy link is required.
- Tracking: record every lead's stage (contacted, meeting, deal) and value; this is what lets us report cost per deal and later optimize for quality.
- Every new campaign is created paused; activation and any spend change need the owner's explicit approval with the daily and monthly amount.`;

const COPY = `AD COPY
- The hook and the benefit fit in the first ~80 characters (the rest hides behind "see more"); primary text around 125 characters, headline up to ~40.
- Concrete beats generic: city or neighbourhood, a number, a real differentiator, proof (years, deals, reviews). No stock phrases ("הכי טובים", "איכות ללא פשרות"), no strings of adjectives.
- One clear call to action matching the destination (השאירו פרטים / שלחו הודעה בוואטסאפ / התקשרו).
- Address readers in neutral plural ("מוזמנים", "השאירו פרטים").
- Meta policy: never assert or imply the reader's personal attributes (health, finances, age, religion…). Not "סובלים מכאבי גב?" but "טיפול חדש לכאבי גב".
- Israeli law: nothing misleading or omitting a material fact; prices are full prices including VAT; doctors/clinics may not promise results, show patients, prices or discounts for treatment, or say "מומחה" without a recognized title; real-estate brokers must show their name, that they are brokers and their license number, and market a property only with the owner's documented consent.
- Write 2–3 genuinely different angles (benefit, proof, offer/urgency), never one ad with small word swaps.`;

const CREATIVE = `CREATIVE
- Formats: 4:5 or 1:1 for feed, 9:16 for stories/reels with text away from the top ~14% and bottom ~25%.
- Real photos where trust matters (real estate properties, food, clinics, the team); AI images only for backgrounds, styling and concepts — never invent a property, a dish or a result.
- Image models misspell Hebrew: generate the visual without text; short Hebrew headline/CTA are added separately and must be checked (letter order, final letters, numbers, ₪).
- Variety: 3–5 visually different concepts per campaign; refresh the weakest every 2–4 weeks or when results fall.`;

const SERVICE = `PROACTIVE SERVICE
- New lead: alert the owner at once with the lead's details and a ready reply; remind if no contact within a few hours.
- Weekly: a short report in money terms — spent, inquiries, cost per inquiry, deals reported, one recommendation.
- Watch daily: wasted spend, a winning ad worth more budget, a form or page that stopped working, an expiring connection. Say it in one line with a recommendation and a button.
- Ask once a month how satisfied the owner is (1–5) and what would help most.`;

// What a senior marketer brings to each kind of business: the first campaign to recommend, the few
// questions worth asking, angles that work, form questions and rules.
const INDUSTRIES = {
  real_estate: { first: 'Two separate campaigns, never mixed: recruiting owners who want to sell or rent (exclusives — highest value) and buyers for a specific listing. Start with owner recruitment unless the owner asks for a listing.',
    ask: ['the goal now (owners to recruit / buyers for a listing / renters)', 'what sets the office apart (years in the city, deals, method)', 'broker license number (mandatory in every ad)'],
    angles: ['the city or neighbourhood plus "how much is your apartment really worth"', 'local proof: years and deals in the area', 'buyers already waiting', 'a free market comparison by a broker (not an appraiser)'],
    form: ['name', 'phone', 'property address/area', 'rooms', 'when they plan to sell'],
    rules: 'Free valuation is expected, not a differentiator. Listings: status, location, features, price, WhatsApp, broker name and license. Use real property photos only.' },
  services: { first: 'One lead campaign in the service radius for the main service, with a concrete offer (free first consultation, quote within a day).',
    ask: ['the main service to fill now', 'service area and what sets them apart (speed, warranty, experience, reviews)', 'how they want inquiries (call / WhatsApp / form)'],
    angles: ['the problem solved fast in the area', 'proof: reviews, years, number of jobs', 'a low-commitment first step'],
    form: ['name', 'phone', 'city', 'what they need'],
    rules: 'Clinics, aesthetics and health: no result promises, no patient photos or before/after, no treatment prices or discounts, no "מומחה" without a title, no personal-attribute questions. Lawyers/accountants: no guarantees of outcome.' },
  retail: { first: 'For online shops: a sales campaign to the site if a pixel works, else messages to WhatsApp. For physical shops: local awareness of a specific product or offer with directions/call.',
    ask: ['the product or collection to push', 'the real offer (price incl. VAT, bundle, free delivery)', 'online sales or store visits'],
    angles: ['the product in use, close-up', 'a clear price or offer with a deadline', 'customer reviews'],
    form: ['name', 'phone', 'product of interest'],
    rules: 'Prices must be full prices including VAT. Use real product photos.' },
  fitness: { first: 'A lead campaign for a trial class or intro offer, radius around the studio.',
    ask: ['the class or membership to fill', 'the intro offer (trial class, first month price)', 'who the ideal member is'],
    angles: ['a real class from inside the studio', 'the intro offer with limited spots', 'community and results stories (without body-shaming or personal-attribute claims)'],
    form: ['name', 'phone', 'preferred class time'],
    rules: 'No claims about the reader\'s body or health; no unrealistic results.' },
  generic: { first: 'One lead campaign for the main product or service with a concrete offer, in the area the business serves.',
    ask: ['the main thing to sell now', 'what sets the business apart', 'how they want customers to reach them'],
    angles: ['clear benefit with a local or concrete detail', 'proof', 'a simple offer'],
    form: ['name', 'phone', 'what they are interested in'],
    rules: 'Restaurants and food: real dish photos, opening hours and an easy order/booking action.' }
};

function industry(key) { return INDUSTRIES[key] || INDUSTRIES.generic; }

// Full knowledge for the planner and the conversational model (static part).
const KNOWLEDGE = [MEDIA_BUYING, COPY, CREATIVE, SERVICE].join('\n\n');

module.exports = { MEDIA_BUYING, COPY, CREATIVE, SERVICE, INDUSTRIES, KNOWLEDGE, industry };
