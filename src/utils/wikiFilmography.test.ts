import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePersonCharacters,
  extractFilmographySubpageTitle,
  isFictionalRoleName,
  parseZhWikiFilmographyHtml,
} from './wikiFilmography';

test('extractFilmographySubpageTitle finds URL-encoded filmography subpage', () => {
  const html = `<div class="hatnote">主条目：<a href="/wiki/%E5%B0%8F%E5%8B%9E%E5%8B%83%C2%B7%E9%81%93%E5%B0%BC%E4%BD%9C%E5%93%81%E5%88%97%E8%A1%A8">小劳勃·道尼作品列表</a></div>`;
  assert.equal(extractFilmographySubpageTitle(html), '小勞勃·道尼作品列表');
});

test('isFictionalRoleName filters self-appearances, uncredited roles, and keeps real characters', () => {
  assert.equal(isFictionalRoleName('托尼·史塔克／钢铁侠'), true);
  assert.equal(isFictionalRoleName('夏洛克·福尔摩斯'), true);
  assert.equal(isFictionalRoleName('他自己'), false);
  assert.equal(isFictionalRoleName('本人（客串）'), false);
  assert.equal(isFictionalRoleName('主持人'), false);
  assert.equal(isFictionalRoleName('未挂名'), false);
  assert.equal(isFictionalRoleName('未知'), false);
  assert.equal(isFictionalRoleName('—'), false);
});

test('parseZhWikiFilmographyHtml handles rowspan years, nested ilh links, and skips awards tables', () => {
  const html = `
    <h2>电影</h2>
    <table class="wikitable">
      <tr><th>年份</th><th>片名</th><th>角色</th><th>说明</th></tr>
      <tr>
        <td rowspan="2">2008</td>
        <td><a href="/wiki/%E9%92%A2%E9%93%81%E4%BE%A0_(%E7%94%B5%E5%BD%B1)">钢铁侠</a></td>
        <td><a href="/wiki/%E9%92%A2%E9%93%81%E4%BE%A0">托尼·史塔克／钢铁侠</a></td>
        <td>主演</td>
      </tr>
      <tr>
        <td><span class="ilh-all" data-foreign-title="Tropic Thunder"><span class="ilh-page"><a href="/w/index.php?title=x">热带惊雷</a></span><span class="noprint ilh-comment"><span class="ilh-paren">（</span><span class="ilh-lang">英语</span><span class="ilh-colon">：</span><span class="ilh-link"><a href="https://en.wikipedia.org/wiki/Tropic_Thunder"><span lang="en">Tropic Thunder</span></a></span><span class="ilh-paren">）</span></span></span></td>
        <td>柯克·拉扎勒斯</td>
        <td>提名奥斯卡</td>
      </tr>
      <tr>
        <td>2023</td>
        <td><a href="/wiki/%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98_(%E7%94%B5%E5%BD%B1)">奥本海默</a></td>
        <td><a href="/wiki/%E8%B7%AF%E6%98%93%E6%96%AF%C2%B7%E6%96%AF%E7%89%B9%E5%8A%B3%E6%96%AF">路易斯·斯特劳斯</a></td>
        <td>获奥斯卡最佳男配角</td>
      </tr>
    </table>
    <h2>奖项</h2>
    <table class="wikitable">
      <tr><th>年份</th><th>颁奖典礼</th><th>奖项</th><th>结果</th></tr>
      <tr><td>2024</td><td>奥斯卡金像奖</td><td>最佳男配角</td><td>获奖</td></tr>
    </table>
  `;

  const parsed = parseZhWikiFilmographyHtml(html);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].year, '2008');
  assert.equal(parsed[0].filmTitle, '钢铁侠');
  assert.equal(parsed[0].characterName, '托尼·史塔克／钢铁侠');
  assert.equal(parsed[0].characterWikiTitle, '钢铁侠');

  // Row 2 inherits rowspan year 2008 and strips ilh-comment
  assert.equal(parsed[1].year, '2008');
  assert.equal(parsed[1].filmTitle, '热带惊雷');
  assert.equal(parsed[1].filmOriginalTitle, 'Tropic Thunder');
  assert.equal(parsed[1].characterName, '柯克·拉扎勒斯');

  assert.equal(parsed[2].year, '2023');
  assert.equal(parsed[2].filmTitle, '奥本海默');
  assert.equal(parsed[2].characterName, '路易斯·斯特劳斯');
});

test('aggregatePersonCharacters merges recurring roles and ranks iconic roles first', () => {
  const agg = aggregatePersonCharacters([
    { year: '1970', filmTitle: '狗狗人生', characterName: '小狗', mediaType: 'film' },
    {
      year: '2008',
      filmTitle: '钢铁侠',
      characterName: '托尼·史塔克',
      characterWikiTitle: '钢铁侠',
      mediaType: 'film',
    },
    {
      year: '2012',
      filmTitle: '复仇者联盟',
      characterName: '托尼·史塔克／钢铁侠',
      mediaType: 'film',
    },
    {
      year: '2019',
      filmTitle: '复仇者联盟4：终局之战',
      characterName: '托尼·史塔克／钢铁侠',
      mediaType: 'film',
    },
    {
      year: '2026',
      filmTitle: '复仇者联盟5：毁灭之日',
      characterName: '维克多·冯·杜姆／末日博士',
      characterWikiTitle: '末日博士',
      mediaType: 'film',
    },
  ]);

  assert.equal(agg.length, 3);
  assert.equal(agg[0].characterName, '托尼·史塔克／钢铁侠');
  assert.equal(agg[0].appearances, 3);
  assert.equal(agg[0].latestYear, '2019');
  assert.equal(agg[1].characterName, '维克多·冯·杜姆／末日博士');
  assert.equal(agg[2].characterName, '小狗');
});
