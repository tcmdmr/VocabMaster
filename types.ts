export interface WordDefinition {
  engMeaning: string;
  trMeaning: string;
  sentence: string;
}

export interface WordItem {
  id: string;
  word: string;
  definitions: WordDefinition[];
}

export type CategoryKey = string; // Relaxed type to allow loading from JSON keys

export type WordData = Record<CategoryKey, WordItem[]>;

export interface Option {
  id: string; // Unique identifier for the option logic
  text: string; // The display text (TR or ENG)
  isCorrect: boolean;
  language: 'TR' | 'ENG';
}

export interface QuestionState {
  currentWord: WordItem;
  targetDefinitionIndex: number; 
  options: Option[]; // Changed from string[] to object to handle mixed language logic
}
