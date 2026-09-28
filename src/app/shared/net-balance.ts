import { Component, computed, input } from '@angular/core';
import { Balances } from '../core/models';
import { moneySign } from '../core/money';
import { MoneyPipe } from './ui';

@Component({
  selector: 'app-net-balance',
  standalone: true,
  imports: [MoneyPipe],
  template: `
    <section class="net-balance-card" aria-label="Net balance of personal loans">
      <span class="eyebrow">YOUR NET BALANCE</span>
      <p class="net-formula">You’ll receive − You owe</p>
      @if (values() === undefined) {
        <strong class="net-empty">Not available</strong>
        <p class="net-status">Your receivables and payables are shown separately.</p>
      } @else {
        <div class="net-balances">
          @for (entry of entries(); track entry.currency) {
            <div class="net-balance-entry">
              <strong
                [class.amount-receivable]="entry.sign > 0"
                [class.amount-payable]="entry.sign < 0"
                [class.amount-zero]="entry.sign === 0"
                >{{ entry.amount | money: entry.currency : true }}</strong
              >
              <span class="net-status">
                {{
                  entry.sign > 0
                    ? 'Net to receive'
                    : entry.sign < 0
                      ? 'Net to pay'
                      : 'Balanced overall'
                }}
              </span>
            </div>
          } @empty {
            <strong class="net-empty amount-zero">0</strong>
            <span class="net-status">No outstanding loans</span>
          }
        </div>
      }
      <p class="net-scope">Personal loans only. Group balances are separate.</p>
    </section>
  `,
})
export class NetBalanceComponent {
  values = input<Balances>();
  protected entries = computed(() =>
    Object.entries(this.values() ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount, sign: moneySign(amount) })),
  );
}
