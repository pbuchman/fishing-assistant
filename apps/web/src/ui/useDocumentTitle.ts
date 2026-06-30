import { useEffect } from 'react';

const productTitle = 'Fishing Assistant';

export function formatDocumentTitle(pageTitle: string): string {
  const trimmedTitle = pageTitle.trim();
  return trimmedTitle.length === 0 ? productTitle : `${trimmedTitle} - ${productTitle}`;
}

export function useDocumentTitle(pageTitle: string): void {
  useEffect(() => {
    document.title = formatDocumentTitle(pageTitle);
  }, [pageTitle]);
}
