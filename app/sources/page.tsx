import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';

export default async function SourcesPage() {
  if (!(await isAuthed())) redirect('/login');

  const sources = await prisma.lessonSource.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { lesson: { select: { id: true, title: true, topic: true } } },
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">Uploaded sources</h1>
          <a href="/learn" className="text-sm text-slate-500 hover:text-slate-900">
            ← Back to training
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-slate-500 mb-4">
          Reference documents that have been uploaded by anyone in the firm. Click a filename to view the original.
        </p>

        {sources.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
            No sources uploaded yet. Attach a document in the chat at <a href="/learn" className="text-brand-600 underline">/learn</a> to add one.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-left">
                  <tr>
                    <th className="p-3 font-medium text-slate-600">Uploaded</th>
                    <th className="p-3 font-medium text-slate-600">File</th>
                    <th className="p-3 font-medium text-slate-600">Size</th>
                    <th className="p-3 font-medium text-slate-600">Tokens</th>
                    <th className="p-3 font-medium text-slate-600">Uploader</th>
                    <th className="p-3 font-medium text-slate-600">Used in lesson</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('en-GB')}
                      </td>
                      <td className="p-3">
                        <a href={s.blobUrl} target="_blank" rel="noopener" className="text-brand-600 hover:underline">
                          {s.filename}
                        </a>
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {(s.fileSizeBytes / 1024).toFixed(0)} KB
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        ~{s.approxTokens.toLocaleString()}
                      </td>
                      <td className="p-3 text-slate-600 font-mono text-xs">{s.uploaderEmail}</td>
                      <td className="p-3 text-slate-700">
                        {s.lesson ? (
                          <a href={`/learn/${s.lesson.id}`} className="text-brand-600 hover:underline text-sm">
                            {s.lesson.title}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
