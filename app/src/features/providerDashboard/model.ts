export const firstName = (name: string) => (name || 'Customer').split(' ')[0] ?? name;
