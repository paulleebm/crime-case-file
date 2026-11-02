import { test } from 'node:test';
import assert from 'node:assert/strict';
import { josa } from '../src/engine/josa';

test('받침에 따라 조사를 고른다', () => {
  assert.equal(josa('문태준', '이/가'), '문태준이');
  assert.equal(josa('한민아', '이/가'), '한민아가');
  assert.equal(josa('진열대 기념품 대장', '은/는'), '진열대 기념품 대장은');
  assert.equal(josa('사인 감정', '은/는'), '사인 감정은');
  assert.equal(josa('휴대폰 상세 분석', '을/를'), '휴대폰 상세 분석을');
  assert.equal(josa('통화 기록', '을/를'), '통화 기록을');
  assert.equal(josa('「준서 휴대폰의 아버지 문자」', '이/가'), '「준서 휴대폰의 아버지 문자」가');
  assert.equal(josa('TU-E04', '이/가'), 'TU-E04가');
  assert.equal(josa('ABC', '이/가'), 'ABC이(가)');
  assert.equal(josa('서울', '으로/로'), '서울로');
});
