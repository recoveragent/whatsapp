export interface TrainingSource {
  id: string;
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
}

export interface TrainingFaq {
  id: string;
  question: string;
  answer: string;
  sourceId: string | null;
  topicQuote: string;
  generatedAnswer: string;
  merchantEdited: boolean;
  approved: boolean;
}

export interface TrainingSet {
  account_id: string;
  website_url: string;
  sources: TrainingSource[];
  faqs: TrainingFaq[];
  revision: number;
  published_revision: number | null;
  published_at: string | null;
  updated_at: string;
}
