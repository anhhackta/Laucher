import { useState, useEffect } from 'react';
import en from '../locales/en.json';
import vi from '../locales/vi.json';

type Language = 'en' | 'vi';

interface Translations {
  [key: string]: any;
}

const translations: Record<Language, Translations> = {
  en: en as Translations,
  vi: vi as Translations,
};

export const useLanguage = () => {
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [t, setT] = useState<Translations>(translations.en);

  useEffect(() => {
    // Load saved language from localStorage
    const savedLanguage = localStorage.getItem('launcher_language') as Language;
    if (savedLanguage && translations[savedLanguage]) {
      setCurrentLanguage(savedLanguage);
      setT(translations[savedLanguage]);
    }
  }, []);

  const changeLanguage = (language: Language) => {
    if (translations[language]) {
      setCurrentLanguage(language);
      setT(translations[language]);
      localStorage.setItem('launcher_language', language);
    }
  };

  const getText = (key: string, variables?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let value: any = t;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key; // Return key if translation not found
      }
    }

    if (typeof value !== 'string') {
      return key;
    }

    if (!variables) {
      return value;
    }

    let result = value;
    for (const [variableKey, variableValue] of Object.entries(variables)) {
      const pattern = new RegExp(`{{\s*${variableKey}\s*}}`, 'g');
      result = result.replace(pattern, String(variableValue));
    }

    return result;
  };

  return {
    currentLanguage,
    changeLanguage,
    t: getText,
    availableLanguages: Object.keys(translations) as Language[]
  };
};
