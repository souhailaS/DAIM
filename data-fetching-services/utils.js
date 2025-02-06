


// Generate size ranges with dynamic increments
export const generateSizeRanges = (maxSize, step) => {
  const ranges = [];
  for (let i = 50000; i < maxSize; i += step) {
    ranges.push(`${i}..${i + step - 1}`);
  }
  return ranges;
};