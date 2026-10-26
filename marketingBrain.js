'use strict';
// Pure marketing decision helpers. No external effects.
function nextAction(profile) {
  const answers=Object.values(profile.answers||{});
  const find=(field)=>answers.find(a=>a.field===field&&a.status==='known')?.value;
  const audience=String(find('target_audience')||find('audience')||'');
  const budget=answers.find(a=>/budget/i.test(a.field)&&typeof a.value==='number');
  const offer=answers.find(a=>/offer/i.test(a.field)&&a.status==='known');
  const suggestions=[];
  if(/כל (?:התחומים|בעלי העסקים)|כולם/.test(audience)) suggestions.push('קהל היעד רחב. כדאי לבדוק באילו ענפים כבר היו תוצאות טובות לפני שבוחרים מיקוד.');
  if(budget) suggestions.push('נרשם תקציב. כדי להעריך כדאיות יש לבדוק שווי לקוח ושיעור סגירה, ללא הבטחת תוצאות.');
  if(offer&&/14/.test(String(offer.value))) suggestions.push('יש לברר אם תקציב המדיה משולם בנפרד ומה קורה בתום 14 הימים.');
  return suggestions;
}
module.exports={nextAction};
