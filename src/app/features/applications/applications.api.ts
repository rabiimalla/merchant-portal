import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ApplicationData,
  ApplicationDetail,
  ApplicationSummary,
  DecisionPayload,
  ListQuery,
  Page,
  SensitiveFieldName,
} from '../../core/models';

/**
 * Thin, typed wrapper around the REST API. No state lives here: components own their state
 * (signals) and treat these methods as cold observables (one HTTP call per subscription).
 */
@Injectable({ providedIn: 'root' })
export class ApplicationsApi {
  readonly #http = inject(HttpClient);

  list(query: ListQuery): Observable<Page<ApplicationSummary>> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.status) params = params.set('status', query.status);
    if (query.q.trim()) params = params.set('q', query.q.trim());
    return this.#http.get<Page<ApplicationSummary>>('/api/applications', { params });
  }

  get(id: string): Observable<ApplicationDetail> {
    return this.#http.get<ApplicationDetail>(`/api/applications/${encodeURIComponent(id)}`);
  }

  createDraft(data: ApplicationData): Observable<ApplicationDetail> {
    return this.#http.post<ApplicationDetail>('/api/applications', data);
  }

  saveDraft(id: string, data: ApplicationData): Observable<{ id: string; updatedAt: string }> {
    return this.#http.put<{ id: string; updatedAt: string }>(`/api/applications/${encodeURIComponent(id)}/draft`, data);
  }

  submit(id: string): Observable<ApplicationDetail> {
    return this.#http.post<ApplicationDetail>(`/api/applications/${encodeURIComponent(id)}/submit`, {});
  }

  decide(id: string, payload: DecisionPayload): Observable<ApplicationDetail> {
    return this.#http.post<ApplicationDetail>(`/api/applications/${encodeURIComponent(id)}/decision`, payload);
  }

  assign(id: string, reviewerId: string): Observable<ApplicationDetail> {
    return this.#http.put<ApplicationDetail>(`/api/applications/${encodeURIComponent(id)}/assignment`, { reviewerId });
  }

  reviewers(): Observable<{ id: string; name: string }[]> {
    return this.#http.get<{ id: string; name: string }[]>('/api/reviewers');
  }

  /** Server-side, role-checked and audit-logged. Never cache the result. */
  reveal(id: string, field: SensitiveFieldName, index = 0): Observable<{ value: string }> {
    return this.#http.post<{ value: string }>(`/api/applications/${encodeURIComponent(id)}/reveal`, { field, index });
  }
}
