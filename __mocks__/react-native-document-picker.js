module.exports = {
  pick: jest.fn(() => Promise.reject({ message: 'User cancelled', code: 'DOCUMENT_PICKER_CANCELED' })),
  isCancel: jest.fn(() => true),
  types: {
    allFiles: 'public.item',
    images: 'public.image',
    pdf: 'com.adobe.pdf',
  },
};
