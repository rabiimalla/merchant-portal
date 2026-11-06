import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  template: `
    <h1 class="h3">You do not have access to that page</h1>
    <p>Your role does not allow this action. If you think this is a mistake, ask an administrator.</p>
    <a routerLink="/applications" class="btn btn-primary">Back to applications</a>
  `,
})
export class Forbidden {}
