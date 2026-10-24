/* ✦ Ask in Hinglish and Hindi (offline).
 *
 * People type the way they speak: "isko laal karo aur fade in karo",
 * "“Sale” title jodo", "इसे बीच में रखो". This turns the common phrasings into
 * the English phrases the offline parser already understands, clause by
 * clause. Quoted text arrives masked (n) and is left alone.
 * Anything it doesn't recognise passes through unchanged. */

/** Devanagari → Roman for the words below (longest first; plain replace,
 *  since \b doesn't see Devanagari letters as word characters). */
const DEVANAGARI: Array<[string, string]> = ([
  ['बीच में', 'beech mein'], ['कर दो', 'kar do'], ['हटा दो', 'hata do'], ['मिटा दो', 'mita do'], ['घुमा दो', 'ghuma do'], ['हिला दो', 'hila do'],
  ['सफ़ेद', 'safed'], ['सफेद', 'safed'], ['गुलाबी', 'gulabi'], ['नारंगी', 'narangi'], ['बैंगनी', 'baingani'], ['सुनहरा', 'sunehra'],
  ['लाल', 'laal'], ['नीला', 'neela'], ['नीली', 'neeli'], ['हरा', 'hara'], ['हरी', 'hari'], ['पीला', 'peela'], ['पीली', 'peeli'], ['काला', 'kaala'], ['काली', 'kaali'],
  ['इसको', 'isko'], ['इसे', 'ise'], ['करो', 'karo'], ['करें', 'karein'], ['रखो', 'rakho'], ['लाओ', 'lao'], ['बनाओ', 'banao'],
  ['हटाओ', 'hatao'], ['मिटाओ', 'mitao'], ['जोड़ो', 'jodo'], ['जोडो', 'jodo'], ['डालो', 'daalo'], ['लिखो', 'likho'],
  ['घुमाओ', 'ghumao'], ['हिलाओ', 'hilao'], ['धीमा', 'dheema'], ['तेज़', 'tez'], ['तेज', 'tez'],
  ['टाइटल', 'title'], ['शीर्षक', 'title'], ['तारा', 'tara'], ['गोला', 'gola'], ['डिब्बा', 'dabba'], ['आयत', 'aayat'],
  ['फ़ेड इन', 'fade in'], ['फेड इन', 'fade in'], ['फ़ेड आउट', 'fade out'], ['फेड आउट', 'fade out'], ['ग़ायब', 'gayab'], ['गायब', 'gayab'],
  ['बैकग्राउंड', 'background'], ['और', 'aur'], ['फिर', 'phir'], ['सेकंड', 'second'], ['का', 'ka'], ['की', 'ki'], ['एक', 'ek'],
] as Array<[string, string]>).sort((a, b) => b[0].length - a[0].length);

const COLOR: Record<string, string> = {
  laal: 'red', lal: 'red', neela: 'blue', neeli: 'blue', nila: 'blue', hara: 'green', hari: 'green',
  peela: 'yellow', peeli: 'yellow', pila: 'yellow', safed: 'white', kaala: 'black', kaali: 'black', kala: 'black',
  gulabi: 'pink', narangi: 'orange', baingani: 'purple', sunehra: 'gold', sunehri: 'gold',
};
const COLOR_RE = Object.keys(COLOR).join('|');
const DO = '(?:karo|kar do|kardo|karein|kijiye|banao|bana do|rakho|kar)';
const IT = '(?:ise|isko|iska|is ko|ye|yeh)';

/** One clause, Hinglish → English (or unchanged). */
export function hinglishClause(clause: string): string {
  let s = clause.trim().replace(/\s+/g, ' ');
  const low = s.toLowerCase().replace(/\b(?:please|plz|zara|jara|ji)\b/g, '').replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;
  // colours: "isko laal karo", "rang neela karo", "laal rang karo", "background kaala karo"
  if ((m = low.match(new RegExp(`^(?:background|bg|peeche ka rang|backdrop)\\s+(?:ka rang\\s+)?(${COLOR_RE})(?:\\s+rang)?(?:\\s+${DO})?$`)))) return `background ${COLOR[m[1]]}`;
  if ((m = low.match(new RegExp(`^(?:${IT}\\s+)?(?:(?:ka\\s+)?rang\\s+)?(${COLOR_RE})(?:\\s+rang)?(?:\\s+${DO})?$`)))) return `make it ${COLOR[m[1]]}`;
  // delete
  if (new RegExp(`^(?:${IT}\\s+)?(?:hatao|hata do|mitao|mita do|delete ${DO}|remove ${DO})$`).test(low)) return 'delete it';
  // add a title: "“Sale” likho", "title “Sale” jodo", "“Sale” title daalo"
  if ((m = s.match(/^(?:title|text|heading)?\s*(\d+)\s*(?:title|text|heading)?\s*(?:likho|jodo|daalo|lagao|add karo|add kar do)$/i))) return `add a title ${m[1]}`;
  if ((m = s.match(/^(?:title|text|heading)\s+(?:jodo|daalo|lagao|add karo)\s+(\d+)$/i))) return `add a title ${m[1]}`;
  // add a shape: "ek tara jodo", "gola daalo", "hexagon banao"
  if ((m = low.match(/^(?:ek\s+)?(tara|star|gola|circle|dabba|box|aayat|rectangle|hexagon|triangle|polygon|null)\s+(?:jodo|daalo|banao|bana do|lagao|add karo|add kar do)$/))) {
    const shape = ({ tara: 'star', gola: 'circle', dabba: 'rectangle', box: 'rectangle', aayat: 'rectangle' } as Record<string, string>)[m[1]] ?? m[1];
    return `add a ${shape}`;
  }
  // motion
  if (new RegExp(`^(?:${IT}\\s+)?(?:fade in|dheere se (?:aaye|laao|lao|dikhao))(?:\\s+${DO})?$`).test(low)) return 'fade in';
  if (new RegExp(`^(?:${IT}\\s+)?(?:fade out|gayab|dheere se (?:gayab|chhupao))(?:\\s+(?:${DO}|ho jaye|ho jao))?$`).test(low)) return 'fade out';
  if (new RegExp(`^(?:${IT}\\s+)?beech mein(?:\\s+(?:${DO}|lao|le aao))?$`).test(low)) return 'center it';
  if (new RegExp(`^(?:${IT}\\s+)?(?:ghumao|ghuma do|spin ${DO})$`).test(low)) return 'spin it';
  if (new RegExp(`^(?:${IT}\\s+)?(?:pop ${DO}|uchhaalo|uchhal do)$`).test(low)) return 'pop it in';
  if (new RegExp(`^(?:${IT}\\s+)?(?:hilao|hila do|wiggle ${DO})$`).test(low)) return 'wiggle it';
  if (new RegExp(`^(?:${IT}\\s+)?(?:dheema|slow|slow motion)(?:\\s+${DO})?$`).test(low)) return 'slow motion';
  if (new RegExp(`^(?:${IT}\\s+)?(?:tez|fast|double speed)(?:\\s+${DO})?$`).test(low)) return '2x speed';
  // length: "3 second ka karo", "5 sec ki karo"
  if ((m = low.match(new RegExp(`^(?:${IT}\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:second|sec|s)\\s+(?:ka|ki|lamba|lambi)(?:\\s+${DO})?$`)))) return `trim to ${m[1]}s`;
  s = clause;
  return s;
}

/** Whole prompt (quotes already masked): transliterate, split on aur / phir, translate each clause. */
export function hinglishToEnglish(masked: string): string {
  let s = masked;
  for (const [dev, rom] of DEVANAGARI) s = s.split(dev).join(rom);
  if (s === masked && !/\b(?:karo|kar do|jodo|daalo|likho|hatao|aur|phir|rakho|ghumao|hilao)\b/i.test(s) && !new RegExp(`\\b(?:${COLOR_RE})\\b`, 'i').test(s)) return masked;
  return s.split(/\s+(?:aur|or phir|phir|fir|uske baad)\s+|\s*,\s*/i).map(hinglishClause).join(', ');
}
