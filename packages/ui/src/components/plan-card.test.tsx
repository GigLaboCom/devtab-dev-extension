import { PlanCard, PlanList } from './plan-card';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

// Placeholder texts and amounts: the kit draws whatever the host passes.
const PAID = {
  id: 'plan-monthly',
  name: 'Monthly',
  price: { amount: 'XTS 11.11', period: 'per month' },
  priceNote: 'Tax calculated at checkout.',
  summary: 'Billed every month.',
  includes: ['First line', 'Second line'],
};

describe('PlanCard', () => {
  it('is an li holding an article named by its heading and described by its state line', () => {
    render(
      <PlanList label="Plans">
        <PlanCard {...PAID} state="Renews on Nov 23, 2026." action={<a href="https://web.example.invalid/">Go</a>} />
      </PlanList>,
    );
    const list = screen.getByRole('list', { name: 'Plans' });
    expect(list.tagName).toBe('UL');
    const item = list.querySelector(':scope > li')!;
    const article = item.querySelector<HTMLElement>(':scope > article')!;
    expect(article.getAttribute('aria-labelledby')).toBe('plan-monthly-name');
    expect(article.getAttribute('aria-describedby')).toBe('plan-monthly-state');
    expect(document.getElementById('plan-monthly-name')!.tagName).toBe('H3');
    expect(document.getElementById('plan-monthly-name')!.textContent).toBe('Monthly');
    expect(document.getElementById('plan-monthly-state')!.textContent).toBe('Renews on Nov 23, 2026.');
    expect(screen.getByRole('article', { name: 'Monthly' })).toBe(article);
    // The price is one line: the amount, then the period.
    expect(article.querySelector('.kit-plan-card-price')!.textContent).toBe('XTS 11.11 per month');
    expect(within(article).getByText('Tax calculated at checkout.')).toBeTruthy();
    expect(within(article).getByText('Billed every month.')).toBeTruthy();
    // What it includes: a list whose checks are decoration.
    const includes = article.querySelector('.kit-plan-card-includes')!;
    expect([...includes.querySelectorAll('li')].map(li => li.textContent)).toEqual(['First line', 'Second line']);
    for (const svg of includes.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(within(article).getByRole('link', { name: 'Go' })).toBeTruthy();
    expect(item.hasAttribute('aria-current')).toBe(false);
    expect(article.hasAttribute('data-current')).toBe(false);
  });

  it('the current plan: aria-current on the item, the mark in words, data-current on the card', () => {
    render(
      <PlanList label="Plans">
        <PlanCard id="plan-free" name="Free" summary="Every part, in full." includes={[]} mark="Current plan" current />
      </PlanList>,
    );
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('aria-current')).toBe('true');
    expect(within(item).getByText('Current plan')).toBeTruthy();
    expect(item.querySelector('article')!.hasAttribute('data-current')).toBe(true);
    // A plan without a price shows its summary in the price's place, once; no state line, no description, no list.
    expect(item.querySelector('.kit-plan-card-price')!.textContent).toBe('Every part, in full.');
    expect(within(item).getAllByText('Every part, in full.')).toHaveLength(1);
    expect(item.querySelector('article')!.hasAttribute('aria-describedby')).toBe(false);
    expect(item.querySelector('.kit-plan-card-includes')).toBeNull();
  });

  it('the badge is read after the name, behind a hidden comma', () => {
    render(
      <PlanList label="Plans">
        <PlanCard {...PAID} id="plan-annual" name="Annually" badge="Save with a year" />
      </PlanList>,
    );
    const heading = document.getElementById('plan-annual-name')!;
    expect(heading.textContent).toBe('Annually, Save with a year');
    expect(heading.querySelector('.sr-only')!.textContent).toBe(', ');
    const badge = within(heading).getByText('Save with a year');
    expect(badge.dataset.slot).toBe('badge');
  });

  it('a price not shown: the words stand in its place, the summary under them, no note', () => {
    render(
      <PlanList label="Plans">
        <PlanCard
          id="plan-monthly"
          name="Monthly"
          priceMissing="Price not shown"
          summary="Billed every month."
          includes={[]}
        />
      </PlanList>,
    );
    const price = document.querySelector('.kit-plan-card-price')!;
    expect(price.textContent).toBe('Price not shown');
    expect(price.hasAttribute('data-missing')).toBe(true);
    expect(screen.queryByText(/XTS/)).toBeNull();
    expect(screen.getByText('Billed every month.')).toBeTruthy();
  });

  it('without an action and a state, the card has no foot', () => {
    render(
      <PlanList label="Plans">
        <PlanCard {...PAID} />
      </PlanList>,
    );
    expect(document.querySelector('.kit-plan-card-foot')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PlanList', () => {
  it('counts its cards for the grid; busy → aria-busy, with or without cards', () => {
    const { rerender } = render(
      <PlanList label="Plans" busy>
        {[]}
      </PlanList>,
    );
    const list = screen.getByRole('list', { name: 'Plans' });
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(list.closest('.kit-plans')!.getAttribute('data-count')).toBe('0');
    rerender(
      <PlanList label="Plans">
        <PlanCard {...PAID} id="a" />
        <PlanCard {...PAID} id="b" />
        <PlanCard {...PAID} id="c" />
      </PlanList>,
    );
    expect(screen.getByRole('list', { name: 'Plans' }).hasAttribute('aria-busy')).toBe(false);
    expect(document.querySelector('.kit-plans')!.getAttribute('data-count')).toBe('3');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});
