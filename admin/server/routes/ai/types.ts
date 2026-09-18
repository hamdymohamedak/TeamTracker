export interface ChatRequest {
  question: string;
}

export interface ChatResponse {
  answer: string;
  sql?: string;
  data?: any[];
  suggestions?: string[];
}
