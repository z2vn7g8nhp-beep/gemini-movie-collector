export function SummarySource({ revision }: { revision?: number }) {
  if (!revision) return null;
  return (
    <span className="mt-1 block text-xs text-[#625C54] dark:text-[#A59D90]">
      简介节选自
      <a className="underline hover:text-[#1A1816] dark:hover:text-[#F3EFE6]" href={`https://zh.wikipedia.org/w/index.php?oldid=${revision}`} target="_blank" rel="noreferrer">中文维基百科</a>
      {' · '}
      <a className="underline hover:text-[#1A1816] dark:hover:text-[#F3EFE6]" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
    </span>
  );
}
