export type WorkProvider = 'jira' | 'github' | 'gitlab';
export const WORK_PROVIDERS: WorkProvider[] = ['jira', 'github', 'gitlab'];
export const WORK_LABELS = { jira: 'Jira', github: 'GitHub', gitlab: 'GitLab' };
export interface WorkSelection {
  allProjects: boolean;
  projectIds: string[];
  state: 'open' | 'all';
  autoSync: boolean;
}
export interface WorkCredentials { provider: WorkProvider; token: string; email?: string; site?: string }
export interface WorkState extends WorkSelection {
  provider: WorkProvider;
  connected: boolean;
  account?: string;
  site?: string;
  projects: { id: string; name: string }[];
  lastSync?: string;
}
export interface WorkItem {
  id: string; title: string; projectId: string; projectName: string;
  url: string; status: string; dueDate?: string; missing?: boolean;
}
export interface WorkBatch {
  date: string; key: string; provider: WorkProvider; account: string;
  items: WorkItem[]; syncedAt: string;
}
export interface WorkSnapshot extends WorkBatch { rendered: string }
