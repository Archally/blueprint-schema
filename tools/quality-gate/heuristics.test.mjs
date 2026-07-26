// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyValue, echoesSubject, splitIdentifier, significantWords } from './heuristics.mjs';

describe('splitIdentifier', () => {
  test('splits camelCase, snake_case and kebab-case alike', () => {
    assert.deepEqual(splitIdentifier('payGapReason'), ['pay', 'gap', 'reason']);
    assert.deepEqual(splitIdentifier('pay_gap_reason'), ['pay', 'gap', 'reason']);
    assert.deepEqual(splitIdentifier('pay-gap-reason'), ['pay', 'gap', 'reason']);
    assert.deepEqual(splitIdentifier('HTTPStatus2'), ['http', 'status', '2']);
  });
});

describe('significantWords', () => {
  test('drops articles and filler nouns that carry no meaning', () => {
    assert.deepEqual(significantWords('The criteria field.'), ['criteria']);
    assert.deepEqual(significantWords('This is the value of the item'), []);
  });
});

describe('echoesSubject', () => {
  test('detects a description that merely restates its subject', () => {
    assert.equal(echoesSubject('The criteria field.', 'criteria'), true);
    assert.equal(echoesSubject('Criteria', 'criteria'), true);
    assert.equal(echoesSubject('Pay gap reason', 'payGapReason'), true);
    assert.equal(echoesSubject('The pay gap reason value.', 'pay_gap_reason'), true);
  });

  test('accepts a description that adds meaning beyond the name', () => {
    assert.equal(echoesSubject('Ranked factors that justify a pay gap.', 'criteria'), false);
    assert.equal(echoesSubject('Reason the pay gap is lawful under §3.', 'payGapReason'), false);
  });

  test('treats pure stop-word prose as an echo — it says nothing at all', () => {
    assert.equal(echoesSubject('This is the value.', 'anything'), true);
  });

  // Regression, found by a dry run on a real model (2026-07-25): naming the entity's own KIND was
  // a free pass, because "event" was a word the subject did not contain and so read as new meaning.
  // It is the most natural way to pad an echo to length, which made it the widest hole in the check.
  test('naming the entity kind does not rescue an echo', () => {
    assert.equal(echoesSubject('The residual transferred event.', 'Residual Transferred'), true);
    assert.equal(echoesSubject('The add product command.', 'AddProduct'), true);
    assert.equal(echoesSubject('Template type (VacancyTemplateType).', 'VacancyTemplateView'), true);
    assert.equal(echoesSubject('Order status', 'orderStatus'), true);
  });

  test('but a real statement about the same entity still passes', () => {
    assert.equal(
      echoesSubject('Unused allowance days moved into the next accrual period.', 'Residual Transferred'),
      false,
    );
    assert.equal(
      echoesSubject('Distinguishes a live job posting from a talent-pool placeholder.', 'VacancyTemplateView'),
      false,
    );
  });
});

describe('classifyValue — presence', () => {
  test('absent, blank and empty collections are missing', () => {
    for (const value of [undefined, null, '', '   ', []]) {
      assert.equal(classifyValue(value).status, 'missing', `expected missing for ${JSON.stringify(value)}`);
    }
  });

  test('non-empty collections and non-prose scalars are covered without content rules', () => {
    assert.equal(classifyValue(['a']).status, 'covered');
    assert.equal(classifyValue(42).status, 'covered');
    assert.equal(classifyValue(false).status, 'covered');
    assert.equal(classifyValue({ origin: 'authored' }).status, 'covered');
  });
});

describe('classifyValue — content heuristics (the anti-filler tier)', () => {
  const rules = { min_length: 15, deny: ['TODO', 'string', 'N/A'], deny_echo_of: ['name', 'title'] };
  const context = { name: 'criteria', title: 'JustifyPayGapPayload' };

  test('literal placeholders are filler, not coverage', () => {
    for (const placeholder of ['TODO', 'todo', 'N/A', 'n/a', 'string', 'String']) {
      const result = classifyValue(placeholder, rules, context);
      assert.equal(result.status, 'filler', `expected filler for "${placeholder}"`);
    }
  });

  test('a description that restates the property name is filler', () => {
    const result = classifyValue('The criteria field.', rules, context);
    assert.equal(result.status, 'filler');
    assert.match(String(result.reason), /restates name/);
  });

  test('a substantive description of adequate length is covered', () => {
    const result = classifyValue('Ranked factors justifying the observed pay gap.', rules, context);
    assert.equal(result.status, 'covered');
  });

  test('short prose is filler only when a min_length is declared', () => {
    assert.equal(classifyValue('Order total.', rules, { name: 'x' }).status, 'filler');
    assert.equal(classifyValue('Order total.', undefined, { name: 'x' }).status, 'covered');
  });

  // Guards against the heuristics becoming their own false-positive generator:
  // these are real descriptions of the shape the golden model actually contains.
  test('FALSE POSITIVE GUARD — real, terse golden-style descriptions still pass', () => {
    const realDescriptions = [
      'Unique identifier of the customer order.',
      'ISO-4217 currency code for all monetary amounts.',
      'Timestamp the cart was last modified, UTC.',
      'Quantity requested, must be a positive integer.',
    ];
    for (const description of realDescriptions) {
      const result = classifyValue(description, rules, { name: 'id', title: 'Order' });
      assert.equal(result.status, 'covered', `false positive on: "${description}" (${result.reason})`);
    }
  });

  test('example values are never content-checked — they are data, not prose', () => {
    assert.equal(classifyValue('string', undefined, {}).status, 'covered');
  });
});
