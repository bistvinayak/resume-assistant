// Skills block for the default layout (the approved resume skill): three labeled lines in the
// skill's order, each skill listed once, each line kept short. Applied at render time, so the
// Word file, the PDF and page-fit measurement all see the same lines.

const GROUPS = [
  { label: 'AI & Automation', key: 'skills_ai_tools', max: 8 },
  { label: 'Product & Delivery', key: 'skills_product', max: 8 },
  { label: 'Technical', key: 'skills_technical', max: 10 },
];

function skillGroups(resume) {
  const seen = new Set();
  return GROUPS.map(g => {
    const items = [];
    for (const raw of Array.isArray(resume[g.key]) ? resume[g.key] : []) {
      const item = String(typeof raw === 'object' ? raw?.name || '' : raw || '').trim();
      const k = item.toLowerCase();
      if (!item || seen.has(k)) continue;
      seen.add(k);
      if (items.length < g.max) items.push(item);
    }
    return { label: g.label, items };
  }).filter(g => g.items.length);
}

module.exports = { skillGroups };
