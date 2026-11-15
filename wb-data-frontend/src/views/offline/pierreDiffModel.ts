import {
    parseDiffFromFile,
    type FileContents,
    type FileDiffMetadata,
    type SupportedLanguages,
} from '@pierre/diffs';

export type PierreDiffModel =
    | { kind: 'empty'; additions: 0; deletions: 0; fileDiff: null; previewFile: null }
    | { kind: 'identical'; additions: 0; deletions: 0; fileDiff: null; previewFile: FileContents }
    | { kind: 'whitespace-only'; additions: 0; deletions: 0; fileDiff: null; previewFile: FileContents }
    | { kind: 'diff'; additions: number; deletions: number; fileDiff: FileDiffMetadata; previewFile: null };

/**
 * Computes a @pierre/diffs model + line change stats while gracefully classifying empty,
 * identical, and whitespace-only diffs before invoking the UI renderer.
 */
export function computePierreDiffModel({
    fileName,
    lang,
    oldContents,
    newContents,
    ignoreWhitespace,
}: {
    fileName: string;
    lang?: SupportedLanguages;
    oldContents: string | null;
    newContents: string | null;
    ignoreWhitespace: boolean;
}): PierreDiffModel {
    const resolvedOld = oldContents ?? '';
    const resolvedNew = newContents ?? '';
    if (resolvedOld.length === 0 && resolvedNew.length === 0) {
        return { kind: 'empty', additions: 0, deletions: 0, fileDiff: null, previewFile: null };
    }

    if (oldContents !== null && newContents !== null && oldContents === newContents) {
        return {
            kind: 'identical',
            additions: 0,
            deletions: 0,
            fileDiff: null,
            previewFile: { name: fileName, contents: newContents, lang },
        };
    }

    const oldFile: FileContents | null = oldContents !== null ? { name: fileName, contents: oldContents, lang } : null;
    const newFile: FileContents | null = newContents !== null ? { name: fileName, contents: newContents, lang } : null;
    const input = oldFile !== null && newFile !== null
        ? { oldFile, newFile }
        : oldFile === null && newFile !== null
            ? { oldFile: null, newFile }
            : { oldFile: oldFile!, newFile: null };

    const fileDiff = parseDiffFromFile(input.oldFile, input.newFile, { ignoreWhitespace });
    const additions = fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
    const deletions = fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);

    if (fileDiff.hunks.length === 0) {
        return {
            kind: 'whitespace-only',
            additions: 0,
            deletions: 0,
            fileDiff: null,
            previewFile: newFile ?? oldFile!,
        };
    }

    return {
        kind: 'diff',
        additions,
        deletions,
        fileDiff,
        previewFile: null,
    };
}
