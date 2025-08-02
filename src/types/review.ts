export interface ReviewData {
  pr_title: string;
  pr_author: string;
  pr_url: string;
  head_sha: string;
  base_sha: string;
  changed_files: number;
  additions: number;
  deletions: number;
  files_analyzed?: number;
  step?: string;
  progress?: number;
  issues_found?: number;
  error?: string;
}

export interface FileAnalysis {
  filename: string;
  language: string;
  additions: number;
  deletions: number;
  patch: string;
  shouldReview: boolean;
  issues: CodeIssue[];
}

export interface CodeIssue {
  line: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'security' | 'performance' | 'quality' | 'bug' | 'style';
  message: string;
  suggestion?: string;
  rule?: string;
}

export type ReviewStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';