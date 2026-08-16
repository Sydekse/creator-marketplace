import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { allSamples } from '../lib/notifications/samples';
import { renderNotification } from '../lib/notifications/templates';

/**
 * Render every notification email to a file (KAN-55 AC-7).
 *
 * "Previewable locally without sending real email." Before this there was no way
 * to look at one at all: `ConsoleEmailProvider` logs the recipient and the
 * subject and discards the body, so the only way to read an email this system
 * sends was to configure Resend and mail yourself.
 *
 * **Why a script and not the React Email dev server.** The `react-email` CLI
 * wants a directory of files each default-exporting one template. This repo
 * deliberately has the opposite: a single exhaustive `switch` in
 * `lib/notifications/templates.tsx`, which is what makes "a template per type"
 * (AC-1) a compile error rather than a convention. Splitting it up to satisfy a
 * previewer would trade the guard for the tool. `tsx` is already a devDependency
 * (`npm run db:seed` uses it), so this adds no dependency at all.
 *
 * **Both the HTML and the plain text**, which is the only reason AC-5 is more
 * than a claim. `renderNotification` generates the two from one tree so they
 * cannot disagree about the words — but "generated from the same tree" says
 * nothing about whether the text version is *readable*, and this repo has no DOM
 * test environment to tell anyone. Open the `.txt` files.
 *
 * Nothing here touches the database or the network: it imports the templates and
 * the fixtures and writes files.
 *
 *   npm run email:preview
 */

const OUT_DIR = '.email-preview';

async function main(): Promise<void> {
  // Cleared rather than merged. A renamed or deleted notification type would
  // otherwise leave its old render sitting in the directory, and a stale file is
  // worse than a missing one — it reviews as current.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const samples = allSamples();
  const rows: string[] = [];

  for (const { label, input } of samples) {
    const message = await renderNotification(input);

    const htmlPath = join(OUT_DIR, `${label}.html`);
    const textPath = join(OUT_DIR, `${label}.txt`);

    // The HTML is written byte-for-byte as the provider would send it, so what
    // opens in the browser is the email and not a preview of it.
    writeFileSync(htmlPath, message.html, 'utf8');
    // The subject rides along in the text file. It is part of the email, it is
    // the half a recipient reads first, and there is nowhere to put it in the
    // HTML without changing the document being previewed.
    writeFileSync(
      textPath,
      `Subject: ${message.subject}\n\n${message.text}\n`,
      'utf8'
    );

    rows.push(
      `<tr><td><code>${label}</code></td>` +
        `<td>${escapeHtml(message.subject)}</td>` +
        `<td><a href="${label}.html">html</a></td>` +
        `<td><a href="${label}.txt">text</a></td></tr>`
    );
    console.log(`${label}\n  ${message.subject}`);
  }

  const indexPath = join(OUT_DIR, 'index.html');
  writeFileSync(indexPath, indexHtml(rows), 'utf8');

  console.log(
    `\n${samples.length} emails written to ${OUT_DIR}/\n` +
      `Open ${relative(process.cwd(), indexPath)} to browse them.`
  );
}

/**
 * The subjects are interpolated from fixture data, which is ours — but this is a
 * file opened in a browser, so it gets escaped anyway rather than relying on
 * that staying true.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indexHtml(rows: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Email previews</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: .5rem .75rem; text-align: left; }
  code { font-size: .9em; }
  p { color: #6b7280; }
</style>
</head>
<body>
<h1>Email previews</h1>
<p>
  Rendered from <code>lib/notifications/samples.ts</code>. Rows marked
  <code>--legacy</code> are the same email as it arrives for a
  <code>notification.payload</code> row written before the money breakdown
  existed &mdash; they should read correctly with one figure instead of three.
</p>
<table>
<thead><tr><th>Type</th><th>Subject</th><th></th><th></th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</body>
</html>
`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
