import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<div class="error-page">
    <a class="brand" routerLink="/"><img src="/icon.svg" alt="" />SettleUply</a
    ><span class="empty-symbol">{{ forbidden ? '⊘' : '◇' }}</span>
    <h1>{{ forbidden ? 'This space is restricted.' : 'A little off the path.' }}</h1>
    <p>
      {{
        forbidden
          ? 'You don’t have access to this page.'
          : 'We couldn’t find the page you’re looking for.'
      }}
    </p>
    <a class="button primary" [routerLink]="auth.homeUrl()">Back to your overview</a>
  </div>`,
})
export class ErrorPage {
  auth = inject(Auth);
  forbidden = inject(ActivatedRoute).snapshot.data['forbidden'] === true;
}
