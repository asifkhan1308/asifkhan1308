// UI strings live here, not in components. English is complete; Hindi and
// Hinglish cover the main surfaces and fall back to English elsewhere.

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'hi' | 'hinglish';

const en = {
  'app.tagline': 'Talk to your footage.',
  'app.sub': 'A local-first video editor. Your footage never leaves this device.',
  'home.new': 'New project',
  'home.drop': 'Drop videos here to start a project',
  'home.projects': 'Projects',
  'home.empty': 'No projects yet.',
  'home.recovered': 'Unsaved changes found',
  'nav.home': 'Home',
  'nav.settings': 'Settings',
  'nav.privacy': 'Privacy',
  'editor.import': 'Import',
  'editor.export': 'Export',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.save': 'Save',
  'editor.saved': 'Saved',
  'editor.media': 'Media',
  'editor.transcript': 'Transcript',
  'editor.emptyTimeline': 'Import a video to begin. Drag files anywhere, or press Import.',
  'ai.ask': 'Ask Kaatchat…',
  'ai.studio': 'AI Studio',
  'ai.tab.ask': 'Ask',
  'ai.tab.find': 'Find',
  'ai.tab.history': 'History',
  'ai.wants': 'Kaatchat wants to:',
  'ai.apply': 'Apply',
  'ai.cancel': 'Cancel',
  'ai.preview': 'Preview changes',
  'ai.suggestions': 'Suggestions',
  'ai.findPlaceholder': 'Find every time I talk about…',
  'ai.addToTimeline': 'Keep only these',
  'ai.jump': 'Jump',
  'jobs.title': 'Processing',
  'jobs.idle': 'Background tasks',
  'jobs.none': 'Nothing running.',
  'recovery.title': 'Recovered project',
  'recovery.body': 'Kaatchat found changes that were not saved, from',
  'recovery.restore': 'Restore',
  'recovery.discard': 'Discard',
  'common.close': 'Close',
  'common.requiresInternet': 'Requires internet',
  'common.notInBuild': 'Not available in this build.',
};

export type StringKey = keyof typeof en;

const hi: Partial<Record<StringKey, string>> = {
  'app.tagline': 'अपनी फ़ुटेज से बात करें।',
  'app.sub': 'लोकल-फ़र्स्ट वीडियो एडिटर। आपकी फ़ुटेज इसी डिवाइस पर रहती है।',
  'home.new': 'नया प्रोजेक्ट',
  'home.drop': 'प्रोजेक्ट शुरू करने के लिए वीडियो यहाँ छोड़ें',
  'home.projects': 'प्रोजेक्ट',
  'home.empty': 'अभी कोई प्रोजेक्ट नहीं।',
  'nav.home': 'होम',
  'nav.settings': 'सेटिंग्स',
  'nav.privacy': 'प्राइवेसी',
  'editor.import': 'इम्पोर्ट',
  'editor.export': 'एक्सपोर्ट',
  'editor.undo': 'पूर्ववत',
  'editor.redo': 'फिर से',
  'editor.save': 'सेव',
  'editor.saved': 'सेव हो गया',
  'editor.media': 'मीडिया',
  'editor.transcript': 'ट्रांसक्रिप्ट',
  'ai.ask': 'Kaatchat से पूछें…',
  'ai.wants': 'Kaatchat यह करना चाहता है:',
  'ai.apply': 'लागू करें',
  'ai.cancel': 'रद्द करें',
  'ai.tab.ask': 'पूछें',
  'ai.tab.find': 'खोजें',
  'ai.tab.history': 'इतिहास',
  'recovery.restore': 'वापस लाएँ',
  'recovery.discard': 'हटाएँ',
  'common.close': 'बंद करें',
  'common.requiresInternet': 'इंटरनेट चाहिए',
};

const hinglish: Partial<Record<StringKey, string>> = {
  'app.tagline': 'Apni footage se baat karo.',
  'app.sub': 'Local-first video editor. Footage isi device pe rehti hai.',
  'home.new': 'Naya project',
  'home.drop': 'Project shuru karne ke liye videos yahan drop karo',
  'home.empty': 'Abhi koi project nahi.',
  'editor.emptyTimeline': 'Shuru karne ke liye video import karo.',
  'ai.ask': 'Kaatchat se poocho…',
  'ai.wants': 'Kaatchat ye karna chahta hai:',
  'ai.apply': 'Apply karo',
  'ai.findPlaceholder': 'Jahan bhi maine … ke baare mein baat ki',
  'recovery.body': 'Kuch changes save nahi hue the, yahan se:',
};

const dicts: Record<Lang, Partial<Record<StringKey, string>>> = { en, hi, hinglish };

const KEY = 'kaatchat.lang';
let lang: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'hi' || v === 'hinglish' ? v : 'en';
  } catch {
    return 'en';
  }
})();
const listeners = new Set<() => void>();

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l === 'hi' ? 'hi' : 'en';
  for (const f of listeners) f();
}

export const getLang = () => lang;

export function t(key: StringKey): string {
  return dicts[lang][key] ?? en[key];
}

/** Re-render on language change. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => lang,
  );
}
