import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';

test('positive / negative / neutral', () => {
  assert.equal(analyze('האתר מעולה, תודה רבה!').sentiment, 'positive');
  assert.equal(analyze('הכל איטי ומתסכל').sentiment, 'negative');
  assert.equal(analyze('רציתי לשאול שאלה').sentiment, 'neutral');
});

test('negation reads negative, not positive (Review Focus 1)', () => {
  assert.equal(analyze('זה לא טוב בכלל').sentiment, 'negative');
  assert.equal(analyze('החיפוש לא נוח').sentiment, 'negative');
});

test('Hebrew prefixes still match (Review Focus 1)', () => {
  assert.equal(analyze('והמשלוח היה איטי').sentiment, 'negative');
  assert.equal(analyze('והמשלוח היה איטי').category, 'delivery');
});

test('no false positive on substrings', () => {
  // "קל" must not match inside "שקלים"
  assert.equal(analyze('שילמתי עשרים שקלים').sentiment, 'neutral');
});

test('rating pushes sentiment', () => {
  assert.equal(analyze('', 1).sentiment, 'negative');
  assert.equal(analyze('', 5).sentiment, 'positive');
  assert.equal(analyze('', 3).sentiment, 'neutral');
  assert.equal(analyze('קצת איטי', 5).sentiment, 'positive');
});

test('empty / null input', () => {
  assert.deepEqual(analyze(null), { sentiment: 'neutral', category: 'other' });
  assert.deepEqual(analyze(''), { sentiment: 'neutral', category: 'other' });
});

test('industry categories for the 5 demo sites', () => {
  assert.equal(analyze('הטיסה התעכבה והמזוודה לא הגיעה').category, 'travel');
  assert.equal(analyze('ביטלו לי את הצ׳ק אין').category, 'travel');
  assert.equal(analyze('חייבו אותי פעמיים בחשבונית').category, 'billing');
  assert.equal(analyze('אין קליטה בבית והאינטרנט נופל').category, 'connectivity');
  assert.equal(analyze('יותר מדי פרסומות בכתבה').category, 'content');
  assert.equal(analyze('המרשם לא היה מוכן בבית המרקחת').category, 'pharmacy');
});

test('categories, first match wins in list order', () => {
  assert.equal(analyze('התשלום בקופה נכשל').category, 'checkout');
  assert.equal(analyze('השליח לא הגיע').category, 'delivery');
  assert.equal(analyze('המחירים יקרים').category, 'prices');
  assert.equal(analyze('האתר נתקע בטעינה').category, 'site');
  assert.equal(analyze('הנציג היה אדיב').category, 'service');
  assert.equal(analyze('סתם רציתי להגיד שלום').category, 'other');
  assert.equal(analyze('האתר נתקע בתשלום').category, 'checkout');
});
