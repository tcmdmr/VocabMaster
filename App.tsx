import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CategoryKey, QuestionState, WordData, WordItem, Option } from './types';

// Helper to shuffle array
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const App: React.FC = () => {
  const [vocabData, setVocabData] = useState<WordData | null>(null);
  const [category, setCategory] = useState<CategoryKey>('Basic Verb');
  const [question, setQuestion] = useState<QuestionState | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [learnedWords, setLearnedWords] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('learnedWords');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error('Error parsing learned words', e);
        }
      }
    }
    return new Set();
  });
  const [hideLearned, setHideLearned] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hideLearned');
      return saved === 'true';
    }
    return false;
  });
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isLearnedModalOpen, setIsLearnedModalOpen] = useState(false);

  // Save learned words to localStorage
  useEffect(() => {
    localStorage.setItem('learnedWords', JSON.stringify(Array.from(learnedWords)));
  }, [learnedWords]);

  // Save hideLearned setting
  useEffect(() => {
    localStorage.setItem('hideLearned', hideLearned.toString());
  }, [hideLearned]);

  // Google Translate Helper
  useEffect(() => {
    const handleDoubleClick = () => {
      const selection = window.getSelection()?.toString().trim();
      if (selection && selection.length > 0) {
        // Clean selection from punctuation
        const word = selection.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
        if (word.length > 0) {
          const url = `https://translate.google.com/?sl=auto&tl=tr&text=${encodeURIComponent(word)}&op=translate`;
          
          // Popup window features
          const width = 500;
          const height = 600;
          const left = (window.screen.width / 2) - (width / 2);
          const top = (window.screen.height / 2) - (height / 2);
          
          window.open(
            url, 
            'GoogleTranslate', 
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,location=no,toolbar=no,menubar=no`
          );
        }
      }
    };

    window.addEventListener('dblclick', handleDoubleClick);
    return () => window.removeEventListener('dblclick', handleDoubleClick);
  }, []);

  // Load data via dynamic import to ensure correct path resolution in production
  useEffect(() => {
    import('./vocab.json')
      .then(module => {
        setVocabData(module.default as WordData);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Vocabulary data could not be loaded');
        setLoading(false);
      });
  }, []);

  const categories = useMemo(() => (vocabData ? Object.keys(vocabData) : []), [vocabData]);

  // Flatten all words for a global distractor pool if needed
  const allWords = useMemo(() => {
    if (!vocabData) return [];
    return Object.values(vocabData).reduce<WordItem[]>((acc, words) => acc.concat(words), []);
  }, [vocabData]);

  const createQuestionForWord = useCallback((targetWord: WordItem, poolOfDistractors: WordItem[]) => {
    // Select one of the definitions
    const targetDefIndex = Math.floor(Math.random() * targetWord.definitions.length);
    const targetDef = targetWord.definitions[targetDefIndex];

    // Determine if we ask for TR or ENG meaning (50/50 chance)
    const isCorrectEng = Math.random() > 0.5;
    const correctOption: Option = {
      id: 'correct',
      text: isCorrectEng ? targetDef.engMeaning : targetDef.trMeaning,
      isCorrect: true,
      language: isCorrectEng ? 'ENG' : 'TR'
    };

    // Pick distractors
    let potentialDistractors = poolOfDistractors.filter(w => w.id !== targetWord.id);
    // If the category pool is too small, use the global pool
    if (potentialDistractors.length < 5 && allWords.length > 5) {
      potentialDistractors = allWords.filter(w => w.id !== targetWord.id);
    }

    const shuffledOthers = shuffleArray(potentialDistractors);
    const distractorOptions: Option[] = [];
    
    for (const w of shuffledOthers) {
      if (distractorOptions.length >= 4) break;
      
      const dDef = w.definitions[Math.floor(Math.random() * w.definitions.length)];
      const isDistractorEng = Math.random() > 0.5;
      const dText = isDistractorEng ? dDef.engMeaning : dDef.trMeaning;

      // Avoid duplicate texts in options
      if (dText !== correctOption.text && !distractorOptions.some(o => o.text === dText)) {
        distractorOptions.push({
          id: `dist-${w.id}-${Math.random()}`,
          text: dText,
          isCorrect: false,
          language: isDistractorEng ? 'ENG' : 'TR'
        });
      }
    }

    const options = shuffleArray([correctOption, ...distractorOptions]);

    setQuestion({
      currentWord: targetWord,
      targetDefinitionIndex: targetDefIndex,
      options
    });
    
    setSelectedOptionId(null);
    setIsAnswered(false);
  }, [allWords]);

  const generateQuestion = useCallback((cat: CategoryKey) => {
    if (!vocabData || !vocabData[cat]) return;
    let words = vocabData[cat];
    if (words.length === 0) return;

    // Filter learned words if option is enabled
    if (hideLearned) {
      const unlearnedWords = words.filter(w => !learnedWords.has(w.id));
      if (unlearnedWords.length > 0) {
        words = unlearnedWords;
      } else {
        // If all words are learned in this category, we might want to show a message
        // or just show them anyway but with a notice. 
        // For now, let's just use the original list if everything is filtered out
        // to avoid infinite loops or empty states, but the UI should ideally handle this.
      }
    }

    const randomWordIndex = Math.floor(Math.random() * words.length);
    const targetWord = words[randomWordIndex];

    createQuestionForWord(targetWord, words);
  }, [vocabData, createQuestionForWord, hideLearned, learnedWords]);

  const toggleLearned = (wordId: string) => {
    setLearnedWords(prev => {
      const next = new Set(prev);
      if (next.has(wordId)) {
        next.delete(wordId);
      } else {
        next.add(wordId);
      }
      return next;
    });
  };

  const clearLearnedWords = () => {
    localStorage.setItem('learnedWords', '[]');
    setLearnedWords(new Set());
    setIsConfirmingClear(false);
  };

  // Initial question generation after data is loaded
  useEffect(() => {
    if (!loading && vocabData && !question) {
      generateQuestion(category);
    }
  }, [loading, vocabData, category, generateQuestion, question]);

  const handleCategorySelect = (cat: CategoryKey) => {
    setCategory(cat);
    setQuestion(null); // Reset to trigger generation in useEffect
    setStreak(0);
  };

  const handleOptionClick = (opt: Option) => {
    if (isAnswered) return;
    setSelectedOptionId(opt.id);
    setIsAnswered(true);
    if (opt.isCorrect) {
      setStreak(s => s + 1);
    } else {
      setStreak(0);
    }
  };

  const handleNext = () => {
    generateQuestion(category);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-semibold text-slate-600">Loading Vocabulary...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Error</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <button onClick={() => window.location.reload()} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">Retry</button>
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div 
      className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-900 selection:bg-blue-100"
    >
      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <h1 className="text-xl font-black bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent italic">
          VocabMaster
        </h1>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          {isSidebarOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>
      </header>

      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 z-50 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col h-full
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-slate-100 flex-shrink-0 hidden md:block">
          <h1 className="text-2xl font-black bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent italic">
            VocabMaster
          </h1>
          <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Current Progress</p>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-blue-700">Daily Streak</span>
              <span className="text-xl font-black text-blue-800">🔥 {streak}</span>
            </div>
          </div>
        </div>

        {/* Mobile-only Streak Info */}
        <div className="p-4 md:hidden border-b border-slate-100">
           <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex justify-between items-center">
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Daily Streak</span>
              <span className="text-lg font-black text-blue-800">🔥 {streak}</span>
            </div>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 px-2">Kategoriler</h2>
          <div className="flex flex-col gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  handleCategorySelect(cat);
                  setIsSidebarOpen(false);
                }}
                className={`px-4 py-3 rounded-xl text-left text-sm font-bold transition-all flex justify-between items-center group
                  ${category === cat 
                    ? 'bg-slate-900 text-white shadow-lg' 
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
              >
                <span>{cat}</span>
                {category === cat && (
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Settings Section */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 px-2">İstatistikler</h2>
          <button 
            onClick={() => setIsLearnedModalOpen(true)}
            className="w-full px-4 py-3 mb-4 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.582.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.582.477-4.5 1.253" /></svg>
              <span>Öğrenilen Kelimeler</span>
            </div>
            <span className="bg-blue-500 text-[10px] px-2 py-0.5 rounded-full">{learnedWords.size}</span>
          </button>

          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 px-2">Ayarlar</h2>
          <div className="space-y-3">
            <label className="flex items-center justify-between px-2 cursor-pointer group">
              <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">Öğrenilenleri Gizle</span>
              <div className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={hideLearned}
                  onChange={(e) => setHideLearned(e.target.checked)}
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </div>
            </label>
            
            {isConfirmingClear ? (
              <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 animate-in fade-in slide-in-from-top-2 duration-300">
                <p className="text-[10px] font-bold text-rose-600 mb-2 px-1">Emin misiniz? Tüm ilerleme silinecek.</p>
                <div className="flex gap-2">
                  <button 
                    onClick={clearLearnedWords}
                    className="flex-1 py-2 bg-rose-500 text-white text-[10px] font-black rounded-lg hover:bg-rose-600 transition-colors"
                  >
                    Evet, Sil
                  </button>
                  <button 
                    onClick={() => setIsConfirmingClear(false)}
                    className="flex-1 py-2 bg-slate-200 text-slate-600 text-[10px] font-black rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setIsConfirmingClear(true)}
                className="w-full px-4 py-2 text-left text-xs font-bold text-rose-500 hover:bg-rose-50 rounded-lg transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Listeyi Temizle ({learnedWords.size})
              </button>
            )}
          </div>
        </div>
        
        <div className="p-6 border-t border-slate-100 text-center">
           <p className="text-xs text-slate-400 font-medium italic">"Practice makes perfect."</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-12 flex flex-col items-center max-w-5xl mx-auto w-full overflow-y-auto">
        
        <div className="w-full flex flex-col gap-6 md:gap-8">
          {/* Question Header */}
          <div className="text-center">
            <h2 className="text-slate-400 text-[10px] md:text-sm font-bold uppercase tracking-widest mb-2">Quiz Time • {category}</h2>
            <div className="flex justify-center">
              <h3 className="text-4xl md:text-7xl font-black text-slate-900 tracking-tight break-words">{question.currentWord.word}</h3>
            </div>
          </div>

          {/* Options Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {question.options.map((option, idx) => {
              let btnClass = "w-full p-6 rounded-2xl border-4 text-left font-bold text-lg transition-all duration-300 flex items-start gap-4 relative overflow-hidden select-text ";
              
              if (isAnswered) {
                if (option.isCorrect) {
                  btnClass += "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-md translate-y-[-2px]";
                } else if (option.id === selectedOptionId) {
                  btnClass += "border-rose-500 bg-rose-50 text-rose-800";
                } else {
                  btnClass += "border-slate-100 text-slate-300 opacity-60 cursor-default";
                }
              } else {
                btnClass += "border-white bg-white hover:border-blue-400 hover:shadow-xl hover:translate-y-[-4px] text-slate-700 cursor-pointer shadow-sm";
              }

              return (
                <button 
                  key={idx} 
                  onClick={() => handleOptionClick(option)} 
                  className={btnClass}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-black
                    ${isAnswered && option.isCorrect 
                      ? 'bg-emerald-500 text-white' 
                      : isAnswered && option.id === selectedOptionId 
                        ? 'bg-rose-500 text-white' 
                        : 'bg-slate-100 text-slate-400'}`}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <div className="flex-1">
                    <p>{option.text}</p>
                    <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded mt-2 inline-block
                      ${option.language === 'TR' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                      {option.language}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Feedback Section */}
          {isAnswered && (
            <div className="bg-white rounded-3xl p-5 md:p-8 shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-8 duration-700 fade-in">
              <div className="flex flex-col gap-6 md:gap-8">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-2xl md:text-3xl shadow-lg flex-shrink-0
                    ${question.options.find(o => o.id === selectedOptionId)?.isCorrect ? 'bg-emerald-100 animate-bounce' : 'bg-rose-100'}`}>
                    {question.options.find(o => o.id === selectedOptionId)?.isCorrect ? '🎯' : '💡'}
                  </div>
                  <div>
                    <h4 className={`text-xl md:text-2xl font-black ${question.options.find(o => o.id === selectedOptionId)?.isCorrect ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {question.options.find(o => o.id === selectedOptionId)?.isCorrect ? 'Harika! Doğru Cevap.' : 'Öğrenmeye Devam Edelim!'}
                    </h4>
                    <p className="text-slate-500 text-xs md:text-sm font-medium">
                      Bu kelimenin tüm tanımlarına göz at. <span className="text-blue-500 font-bold hidden md:inline">(İpucu: Kelimelere çift tıklayarak çeviriye bakabilirsin!)</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {question.currentWord.definitions.map((def, idx) => {
                    const isTarget = idx === question.targetDefinitionIndex;
                    return (
                      <div key={idx} className={`p-4 md:p-6 rounded-2xl border-2 transition-all ${isTarget ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100'}`}>
                        <div className="flex items-center gap-2 mb-3 md:mb-4">
                          <span className="text-[9px] md:text-[10px] font-black bg-slate-800 text-white px-2 py-0.5 rounded tracking-widest uppercase">Tanım {idx + 1}</span>
                          <div className="flex-1 h-px bg-slate-100"></div>
                        </div>
                        <div className="mb-3 md:mb-4">
                          <h5 className="text-lg md:text-xl font-bold text-slate-900">{def.engMeaning}</h5>
                          <p className="text-blue-600 font-bold italic text-sm md:text-base">{def.trMeaning}</p>
                        </div>
                        <div className="bg-white p-4 md:p-5 rounded-xl shadow-inner border-l-4 border-blue-400">
                          <p className="text-slate-600 leading-relaxed italic font-medium text-sm md:text-base">
                            "{def.sentence}"
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col md:flex-row justify-center md:justify-end gap-3 pt-2 md:pt-4">
                  <button
                    onClick={() => toggleLearned(question.currentWord.id)}
                    className={`px-8 py-4 md:py-5 rounded-2xl font-black transition-all flex items-center justify-center gap-2 border-2
                      ${learnedWords.has(question.currentWord.id)
                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-500 hover:text-emerald-600'
                      }`}
                  >
                    {learnedWords.has(question.currentWord.id) ? (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>
                        Öğrenildi
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        Öğrenildi Olarak İşaretle
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleNext}
                    className="px-8 md:px-12 py-4 md:py-5 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-blue-600 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 group"
                  >
                    Sıradaki Kelime
                    <svg className="w-5 h-5 md:w-6 md:h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-12 text-slate-300 text-[10px] font-black uppercase tracking-[0.3em]">
           English Learning Master • Quiz Edition
        </div>
      </main>

      {/* Learned Words Modal */}
      {isLearnedModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            onClick={() => setIsLearnedModalOpen(false)}
          />
          <div className="relative bg-white w-full max-w-2xl max-h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h2 className="text-xl font-black text-slate-900">Öğrenilen Kelimeler</h2>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Toplam {learnedWords.size} Kelime</p>
              </div>
              <button 
                onClick={() => setIsLearnedModalOpen(false)}
                className="p-2 hover:bg-slate-200 rounded-xl transition-colors text-slate-400 hover:text-slate-900"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {learnedWords.size === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.582.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.582.477-4.5 1.253" /></svg>
                  </div>
                  <p className="font-bold">Henüz öğrenilmiş kelime yok.</p>
                  <p className="text-xs mt-1">Quizleri çözerek kelimeleri listenize ekleyebilirsiniz.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {allWords
                    .filter(w => learnedWords.has(w.id))
                    .map(word => (
                      <div key={word.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between group hover:bg-white hover:shadow-md transition-all">
                        <div className="flex-1 min-w-0 pr-4">
                          <h4 className="text-lg font-black text-slate-900 truncate">{word.word}</h4>
                          <div className="flex gap-2 mt-1 overflow-hidden">
                            {word.definitions.slice(0, 1).map((def, i) => (
                              <p key={i} className="text-xs text-slate-500 font-medium truncate italic">
                                {def.engMeaning} • <span className="text-blue-600">{def.trMeaning}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                        <button 
                          onClick={() => toggleLearned(word.id)}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                          title="Listeden Kaldır"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => setIsLearnedModalOpen(false)}
                className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;