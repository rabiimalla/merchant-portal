import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { AuthStore } from './core/auth/auth.store';

interface NavLink {
  label: string;
  path: string;
  exact: boolean;
}

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(AuthStore);
  protected readonly auth = inject(AuthService);
  protected readonly menuOpen = signal(false);

  /**
   * Permission-aware navigation. Links a role cannot use are not rendered at all; the same
   * rules are enforced again by route guards (canMatch) and, finally, by the API.
   */
  protected readonly links = computed<NavLink[]>(() => {
    const role = this.store.role();
    if (!role) return [];
    const label = role === 'REVIEWER' ? 'My review queue' : role === 'ADMIN' ? 'All applications' : 'My applications';
    const links: NavLink[] = [{ label, path: '/applications', exact: true }];
    if (role === 'SALES') links.push({ label: 'New application', path: '/applications/new', exact: true });
    return links;
  });
}
