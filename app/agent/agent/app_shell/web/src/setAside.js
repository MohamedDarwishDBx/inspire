// REQ-404 part 2: a page set aside by the App shows its notice in place of its data (the App starts without it).
export const asideNotice = (page) => (typeof page?.set_aside === 'string' ? page.set_aside : '');
