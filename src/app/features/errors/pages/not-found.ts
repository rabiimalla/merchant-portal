import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <h1 class="h3">Page not found</h1>
    <p>The page you are looking for does not exist.</p>
    <a routerLink="/applications" class="btn btn-primary">Back to applications</a>
  `,
})
export class NotFound {}
