import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { httpErrorMessage } from '../../../core/http-error';
import { TextField } from '../../../shared/text-field/text-field';


/** Only same-app paths are accepted as a post-login target (prevents open-redirect abuse). */
export const safeReturnUrl = (url: string | undefined | null): string =>
  url && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : '/applications';

@Component({
  imports: [ReactiveFormsModule, TextField],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login {
  /** Bound from the ?returnUrl= query param by withComponentInputBinding(). */
  readonly returnUrl = input<string>();

  readonly #auth = inject(AuthService);
  readonly #router = inject(Router);
  readonly #fb = inject(FormBuilder).nonNullable;

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.#fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.#auth
      .login(email, password)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => void this.#router.navigateByUrl(safeReturnUrl(this.returnUrl())),
        error: (err: unknown) =>
          this.error.set(
            err instanceof HttpErrorResponse && err.status === 401 ? 'Invalid e-mail or password.' : httpErrorMessage(err),
          ),
      });
  }
}
