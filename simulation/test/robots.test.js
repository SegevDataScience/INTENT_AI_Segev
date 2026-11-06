import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPathAllowed } from '../src/robots.js';

const SHUFERSAL = `User-agent: *
Disallow: /online/he/cart
Disallow: /online/he/checkout
Disallow: *?query=*
Disallow: */marketplace/`;

test('allows paths not disallowed, blocks disallowed prefixes', () => {
  assert.equal(isPathAllowed(SHUFERSAL, '/online/he/'), true);
  assert.equal(isPathAllowed(SHUFERSAL, '/online/he/cart'), false);
  assert.equal(isPathAllowed(SHUFERSAL, '/online/he/cart/123'), false);
});

test('supports * wildcards and $ anchors', () => {
  assert.equal(isPathAllowed(SHUFERSAL, '/search?query=milk'), false);
  assert.equal(isPathAllowed(SHUFERSAL, '/x/marketplace/y'), false);
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf'), false);
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf?x=1'), true);
});

test('longest match wins; Allow beats Disallow on a tie', () => {
  const txt = 'User-agent: *\nDisallow: /\nAllow: /heb/';
  assert.equal(isPathAllowed(txt, '/heb/israel'), true);
  assert.equal(isPathAllowed(txt, '/eng/'), false);
  assert.equal(isPathAllowed('User-agent: *\nAllow: /a\nDisallow: /a', '/a'), true);
});

test('only the * group applies (we do not claim another bot identity)', () => {
  const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private';
  assert.equal(isPathAllowed(txt, '/'), true);
  assert.equal(isPathAllowed(txt, '/private/x'), false);
});

test('empty or missing rules allow everything; "Disallow:" with no value allows', () => {
  assert.equal(isPathAllowed('', '/'), true);
  assert.equal(isPathAllowed('User-agent: *\nDisallow:', '/anything'), true);
  assert.equal(isPathAllowed('<html>not robots</html>', '/'), true);
});

test('Disallow: / blocks everything; comments ignored; case-insensitive keys', () => {
  assert.equal(isPathAllowed('user-agent: * # all\nDISALLOW: / # nope', '/'), false);
});
