// Pure clinical calculation utilities — no side effects, no imports.

/**
 * Mifflin-St Jeor and Harris-Benedict BMR formulas.
 * Weight in kg, heightCm in cm, age in years.
 * gender: 'male' | 'female'
 */
export function calculateBMR(gender, weight, heightCm, age) {
  let mifflin;
  if (gender === 'female') {
    mifflin = (10 * weight) + (6.25 * heightCm) - (5 * age) - 161;
  } else {
    mifflin = (10 * weight) + (6.25 * heightCm) - (5 * age) + 5;
  }

  let harris;
  if (gender === 'female') {
    harris = 655.1 + (9.563 * weight) + (1.850 * heightCm) - (4.676 * age);
  } else {
    harris = 66.5 + (13.75 * weight) + (5.003 * heightCm) - (6.75 * age);
  }

  const average = (mifflin + harris) / 2;
  return { mifflin, harris, average };
}

/**
 * Clinical adjusted weight: when BMI > 31.25 (weight > 1.25 × ideal weight at BMI 25),
 * use an adjusted weight to avoid overestimating caloric needs.
 */
export function calculateAdjustedWeight(weight, heightCm) {
  const heightM = heightCm / 100;
  const idealWeight = 25 * (heightM * heightM); // BMI 25
  const threshold = idealWeight * 1.25;          // BMI 31.25

  if (weight > threshold) {
    const adjustedWeight = weight - 0.25 * (weight - idealWeight);
    return { needsAdjustment: true, adjustedWeight, idealWeight };
  }
  return { needsAdjustment: false, adjustedWeight: weight, idealWeight };
}

/**
 * BMI: weight (kg) / height² (m).
 */
export function calculateBMI(weight, heightCm) {
  const heightM = heightCm / 100;
  return weight / (heightM * heightM);
}

/**
 * TDEE: BMR × activity factor.
 */
export function calculateTDEE(bmrAverage, activityFactor) {
  return bmrAverage * activityFactor;
}
