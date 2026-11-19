import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  buildDossierSpecs,
  cleanWikiExtract,
  isSameEntityTitle,
  mergeCharacterProfile,
  parseBangumiCharacterInfobox,
  parseZhWikiCharacterInfobox,
  splitCharacterTitle,
} from './characterProfile';

test('splitCharacterTitle separates slash alias cleanly', () => {
  const res = splitCharacterTitle('维克多·冯·杜姆／末日博士');
  assert.equal(res.primaryName, '维克多·冯·杜姆');
  assert.equal(res.secondaryAlias, '末日博士');

  const single = splitCharacterTitle('索尔');
  assert.equal(single.primaryName, '索尔');
  assert.equal(single.secondaryAlias, undefined);
});

test('isSameEntityTitle prevents film page from being used as character bio', () => {
  assert.equal(
    isSameEntityTitle('复仇者联盟5：毁灭之日', '复仇者联盟5：毁灭之日'),
    true
  );
  assert.equal(
    isSameEntityTitle('盗梦空间 (电影)', '盗梦空间'),
    true
  );
  assert.equal(
    isSameEntityTitle('末日博士', '复仇者联盟5：毁灭之日'),
    false
  );
});

test('cleanWikiExtract strips citations and trims at sentence boundary', () => {
  const raw =
    '维克多·冯·杜姆（Doctor Doom）是漫威漫画旗下的超级反派[1]。他是拉托维尼亚的君主[注 1]，精通尖端科技与黑魔法。他在漫威宇宙中多次与神奇四侠及复仇者联盟交锋。';
  const cleaned = cleanWikiExtract(raw, 65);
  assert.ok(!cleaned.includes('[1]'));
  assert.ok(!cleaned.includes('[注 1]'));
  assert.ok(cleaned.endsWith('。'));
});

test('parseZhWikiCharacterInfobox extracts structured character attributes', () => {
  const html = `
    <table class="infobox vcard">
      <tr><th>本名</th><td>维克多·冯·杜姆<sup>[1]</sup></td></tr>
      <tr><th>职业</th><td>拉托维尼亚君主<br/>科学家<br/>魔法师</td></tr>
      <tr><th>隶属</th><td><ul><li>拉托维尼亚</li><li>阴谋团</li></ul></td></tr>
      <tr><th>国籍</th><td>拉托维尼亚</td></tr>
      <tr><th>能力</th><td>天才智力<br/>动力装甲<br/>黑魔法</td></tr>
      <tr><th>首次登场</th><td>《神奇四侠》#5（1962年7月）</td></tr>
      <tr><th>创作者</th><td>斯坦·李<br/>杰克·科比</td></tr>
    </table>
  `;
  const parsed = parseZhWikiCharacterInfobox(html);
  assert.equal(parsed.alias, '维克多·冯·杜姆');
  assert.equal(parsed.identity, '拉托维尼亚君主 · 科学家 · 魔法师');
  assert.equal(parsed.affiliation, '拉托维尼亚 · 阴谋团');
  assert.equal(parsed.origin, '拉托维尼亚');
  assert.equal(parsed.abilities, '天才智力 · 动力装甲 · 黑魔法');
  assert.equal(parsed.firstAppearance, '《神奇四侠》#5（1962年7月）');
  assert.equal(parsed.creator, '斯坦·李 · 杰克·科比');
});

test('parseBangumiCharacterInfobox handles array and string values', () => {
  const parsed = parseBangumiCharacterInfobox([
    { key: '别名', value: [{ k: '日文名', v: '五条 悟' }, { v: '最强咒术师' }] },
    { key: '职业', value: '特级咒术师' },
    { key: '所属', value: '东京都立咒术高等专门学校' },
  ]);
  assert.equal(parsed.alias, '五条 悟 · 最强咒术师');
  assert.equal(parsed.identity, '特级咒术师');
  assert.equal(parsed.affiliation, '东京都立咒术高等专门学校');
});

test('mergeCharacterProfile preserves user edits and only fills empty fields', () => {
  const merged = mergeCharacterProfile(
    {
      identity: '用户自定义定位',
      highlights: '秘密战争封神时刻',
    },
    {
      identity: '维基默认定位',
      affiliation: '拉托维尼亚',
      bio: '漫威经典反派角色。',
      enrichedAt: '2026-11-18T00:00:00.000Z',
    }
  );
  assert.equal(merged.identity, '用户自定义定位');
  assert.equal(merged.highlights, '秘密战争封神时刻');
  assert.equal(merged.affiliation, '拉托维尼亚');
  assert.equal(merged.bio, '漫威经典反派角色。');
  assert.equal(merged.enrichedAt, '2026-11-18T00:00:00.000Z');
});

test('buildDossierSpecs falls back to slash alias and skips empty fields', () => {
  const item: ArchiveItem = {
    id: 'c1',
    accessionNo: 'CA-002',
    category: 'character',
    title: '维克多·冯·杜姆／末日博士',
    summary: '',
    notes: '',
    rating: 5,
    status: 'favorite',
    tags: [],
    relatedIds: [],
    characterProfile: {
      affiliation: '拉托维尼亚',
      abilities: '天才智力与黑魔法',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const specs = buildDossierSpecs(item);
  assert.equal(specs.length, 3);
  assert.equal(specs[0].label, '别名 / 称号');
  assert.equal(specs[0].value, '末日博士');
  assert.equal(specs[1].label, '所属阵营');
  assert.equal(specs[2].label, '能力与特质');
  assert.equal(specs[2].wide, true);
});
