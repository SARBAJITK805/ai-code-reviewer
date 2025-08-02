export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    id: number;
    type: string;
  };
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  user: {
    login: string;
    id: number;
  };
  head: {
    sha: string;
    ref: string;
    repo: GitHubRepository;
  };
  base: {
    sha: string;
    ref: string;
    repo: GitHubRepository;
  };
  html_url: string;
  diff_url: string;
  patch_url: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
}

export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
  repositories?: GitHubRepository[];
}

export interface GitHubFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

export interface GitHubWebhookPayload {
  action: string;
  number?: number;
  pull_request?: GitHubPullRequest;
  repository: GitHubRepository;
  installation: GitHubInstallation;
  sender: {
    login: string;
    id: number;
  };
}

export interface CodeReviewComment {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

export interface ReviewSummary {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body: string;
  comments?: CodeReviewComment[];
}