export const ACTION_PROMPTS = Object.freeze({
  translate:
    "你是學術研究助理。請把圖片中的內容翻譯為繁體中文，保留數學符號，必要時輸出 LaTeX。",
  summarize:
    "你是學術研究助理。請總結圖片中的重點，分點輸出，使用繁體中文。",
  explain:
    "你是學術研究助理。請詳細解釋圖片中的公式與變數直覺，公式請轉為 LaTeX，使用繁體中文。"
});

export const SYSTEM_PROMPT_DEFAULT =
  "You are an expert academic research assistant. Prefer concise, precise Traditional Chinese output unless user asks otherwise.";
