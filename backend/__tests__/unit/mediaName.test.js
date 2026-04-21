const { isRealImageTitle } = require('../../utils/mediaName');

describe('isRealImageTitle', () => {
  test('accepts human-authored titles', () => {
    expect(isRealImageTitle('Eurofighter Typhoon')).toBe(true);
    expect(isRealImageTitle('F-35 Lightning II')).toBe(true);
    expect(isRealImageTitle('No. 14 Squadron RAF')).toBe(true);
    expect(isRealImageTitle('RAF Coningsby')).toBe(true);
  });

  test('rejects Cloudinary publicId-style values', () => {
    expect(isRealImageTitle('brief-images/brief-1775566123456')).toBe(false);
    expect(isRealImageTitle('brief-1775566123456')).toBe(false);
    expect(isRealImageTitle('brief1775566123456')).toBe(false);
    expect(isRealImageTitle('brief_1775566123456')).toBe(false);
    expect(isRealImageTitle('brief-1775566-news-bulk')).toBe(false);
    expect(isRealImageTitle('brief-images/cutouts/cutout-fake-123')).toBe(false);
    expect(isRealImageTitle('folder/filename.jpg')).toBe(false);
  });

  test('rejects empty / nullish values', () => {
    expect(isRealImageTitle(null)).toBe(false);
    expect(isRealImageTitle(undefined)).toBe(false);
    expect(isRealImageTitle('')).toBe(false);
    expect(isRealImageTitle('   ')).toBe(false);
  });
});
