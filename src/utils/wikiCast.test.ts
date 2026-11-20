import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAcceptableCharacterFallbackPhoto,
  isAcceptablePhoto,
  isFilmPosterImage,
  normalizeEntityKey,
  parseZhWikiCastHtml,
  scoreCharacterImage,
} from './wikiCast';

test('isAcceptablePhoto rejects SVG cartoons and logos while keeping real actor photos', () => {
  assert.equal(isAcceptablePhoto('Marvel Thor.svg'), false);
  assert.equal(
    isAcceptablePhoto('https://commons.wikimedia.org/wiki/Special:FilePath/Marvel_Thor.svg?width=400'),
    false
  );
  assert.equal(isAcceptablePhoto('Batman_logo.png'), false);
  assert.equal(isAcceptablePhoto('Actor_signature.png'), false);

  // Real actor photo taken at San Diego Comic-Con MUST be accepted!
  assert.equal(
    isAcceptablePhoto('Chris_Hemsworth_by_Gage_Skidmore_at_2019_San_Diego_Comic-Con.jpg'),
    true
  );
  assert.equal(isAcceptablePhoto('Vanessa_Kirby_2023.jpg'), true);

  // Character fallback guard rejects expo mannequins / cosplay / statues
  assert.equal(
    isAcceptableCharacterFallbackPhoto('D23 Expo 2015 Ant-Man (3).jpg'),
    false
  );
  assert.equal(
    isAcceptableCharacterFallbackPhoto('Spider-Man_cosplay_2022.jpg'),
    false
  );
  assert.equal(
    isAcceptableCharacterFallbackPhoto('Movie_still_portrait.jpg'),
    true
  );

  // Rejects theatrical film posters accidentally matched for a character
  assert.equal(
    isFilmPosterImage('Inception_(2010)_theatrical_poster.jpg'),
    true
  );
  assert.equal(isFilmPosterImage('Chris_Hemsworth_as_Thor.jpg'), false);

  // Live-action movie character stills outrank generic comic covers
  assert.ok(
    scoreCharacterImage(
      '/api/img-proxy?url=https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fen%2F8%2F88%2FPaul_Rudd_as_Ant-Man.jpg'
    ) >
      scoreCharacterImage(
        '/api/img-proxy?url=https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fen%2F1%2F12%2FAnt-Man_%28Scott_Lang%29.jpg'
      )
  );
});

test('parseZhWikiCastHtml parses list-style and table-style Chinese Wikipedia cast sections', () => {
  const listHtml = `
    <ul>
      <li><a href="/wiki/%E5%B0%8F%E7%BD%97%E4%BC%AF%E7%89%B9%C2%B7%E5%94%90%E5%B0%BC" title="小罗伯特·唐尼">小罗伯特·唐尼</a>饰演<a href="/wiki/Doctor_Doom" title="毁灭博士">维克多·冯·杜姆／毁灭博士</a>（Victor Von Doom / Doctor Doom）：漫威反派<sup class="reference">[1]</sup>。</li>
      <li><a href="/wiki/%E5%85%8B%E9%87%8C%E6%96%AF%C2%B7%E6%B5%B7%E5%A7%86%E6%96%AF%E6%B2%83%E6%96%AF" title="克里斯·海姆斯沃斯">克里斯·海姆斯沃斯</a>饰演索尔（Thor）：阿斯加德雷神。</li>
      <li><a href="/wiki/%E8%8E%B1%E6%98%82%E7%BA%B3%E5%A4%9A" title="莱昂纳多·迪卡普里奥">莱昂纳多·迪卡普里奥</a>：饰“盗梦者”－唐姆·柯布</li>
      <li><a href="/wiki/%E6%A2%81%E6%9C%9D%E4%BC%9F" title="梁朝伟">梁朝伟</a> 饰 周慕云</li>
    </ul>
  `;

  const parsedList = parseZhWikiCastHtml(listHtml);
  assert.equal(parsedList.length, 4);
  assert.equal(parsedList[0].actorName, '小罗伯特·唐尼');
  assert.equal(parsedList[0].actorWikiTitle, '小罗伯特·唐尼');
  assert.equal(parsedList[0].characterName, '维克多·冯·杜姆／毁灭博士');
  assert.equal(parsedList[0].characterWikiTitle, 'Doctor Doom');
  assert.equal(parsedList[0].characterOriginalName, 'Victor Von Doom / Doctor Doom');
  assert.equal(parsedList[2].characterName, '唐姆·柯布');
  assert.equal(parsedList[3].actorName, '梁朝伟');
  assert.equal(parsedList[3].characterName, '周慕云');

  const tableHtml = `
    <table class="wikitable">
      <tr><th>演员</th><th>角色</th><th>简介</th></tr>
      <tr>
        <td><a href="/wiki/%E5%AD%99%E4%BF%AA" title="孙俪">孙俪</a></td>
        <td><a href="/wiki/%E7%94%84%E5%AC%9B">甄嬛</a></td>
        <td>大理寺少卿甄远道长女</td>
      </tr>
      <tr>
        <td><a href="/wiki/%E9%99%88%E5%BB%BA%E6%96%8C" title="陈建斌">陈建斌</a></td>
        <td>雍正帝</td>
        <td>清世宗爱新觉罗·胤禛</td>
      </tr>
    </table>
  `;

  const parsedTable = parseZhWikiCastHtml(tableHtml);
  assert.equal(parsedTable.length, 2);
  assert.equal(parsedTable[0].actorName, '孙俪');
  assert.equal(parsedTable[0].characterName, '甄嬛');
  assert.equal(parsedTable[0].characterWikiTitle, '甄嬛');
  assert.equal(parsedTable[1].actorName, '陈建斌');
  assert.equal(parsedTable[1].characterName, '雍正帝');

  assert.equal(normalizeEntityKey('山姆·威尔逊'), normalizeEntityKey('山姆 威尔逊'));
});

test('parseZhWikiCastHtml ignores Wikipedia infoboxes, authority control navboxes, and non-cast tables', () => {
  const garbagePageHtml = `
    <table class="infobox">
      <tr><th>真名</th><td>安東尼·愛德華·“托尼”·史塔克</td></tr>
      <tr><th>创作者</th><td>史丹·李</td></tr>
      <tr><th>首次登场</th><td>《悬疑故事》</td></tr>
    </table>
    <table class="wikitable">
      <tr><th>中国大陆</th><td>钢铁侠</td></tr>
      <tr><th>香港</th><td>鐵甲奇俠</td></tr>
    </table>
    <table class="navbox authority-control">
      <tr><th>国际</th><td>FAST VIAF 2 3 WorldCat</td></tr>
      <tr><th>各地</th><td>德国 以色列 美国 波兰</td></tr>
    </table>
  `;

  assert.deepEqual(parseZhWikiCastHtml(garbagePageHtml), []);
});

test('parseZhWikiCastHtml separates comma-delimited bios from character names', () => {
  const commaListHtml = `
    <ul>
      <li><a href="/wiki/%E6%9D%B0%E5%A4%AB%C2%B7%E5%B8%83%E9%87%8C%E5%90%89%E6%96%AF">杰夫·布里吉斯</a> 饰演 <a href="/wiki/%E9%93%81%E9%9C%B8%E7%8E%8B">欧巴戴·史坦恩</a>，史塔克工业的副总裁，私下贩售武器给十环帮。</li>
      <li><a href="/wiki/%E8%82%96%E6%81%A9%C2%B7%E6%89%98%E5%B8%83">肖恩·托布</a> 饰演 胡伊申，十环帮的俘虏，协助东尼打造第一套钢铁侠动力服。</li>
    </ul>
  `;
  const parsed = parseZhWikiCastHtml(commaListHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].characterName, '欧巴戴·史坦恩');
  assert.equal(parsed[0].summary, '史塔克工业的副总裁，私下贩售武器给十环帮。');
  assert.equal(parsed[1].characterName, '胡伊申');
});



