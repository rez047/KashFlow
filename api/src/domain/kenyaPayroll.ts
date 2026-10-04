export const kenyaPayrollRuleSet = {
  id: 'KE-2026-01',
  effectiveFrom: '2026-02-01',
  reviewStatus: 'requires-qualified-review',
  sources: [
    'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye',
    'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/affordable-housing-levy',
    'https://www.nssf.or.ke/',
    'https://www.sha.go.ke/',
  ],
  nssf: { rate: 0.06, lowerEarningsLimit: 9_000, upperEarningsLimit: 108_000 },
  nssfEmployerRate: 0.06,
  shif: { rate: 0.0275, minimum: 300 },
  housingLevy: { employeeRate: 0.015, employerRate: 0.015 },
  personalRelief: 2_400,
  payeBands: [
    { width: 24_000, rate: 0.1 },
    { width: 8_333, rate: 0.25 },
    { width: 467_667, rate: 0.3 },
    { width: 300_000, rate: 0.325 },
    { width: Number.POSITIVE_INFINITY, rate: 0.35 },
  ],
} as const

export type KenyaPayrollEstimateInput = {
  grossMonthlyPay: number
  otherTaxableDeductions?: number
  otherTaxReliefs?: number
}

export type KenyaPayrollEstimate = {
  ruleSet: string
  effectiveFrom: string
  reviewRequired: true
  grossMonthlyPay: number
  nssfEmployee: number
  shifEmployee: number
  housingLevyEmployee: number
  taxablePayEstimate: number
  payeBeforeRelief: number
  personalRelief: number
  otherTaxReliefs: number
  payeEstimate: number
  netPayEstimate: number
  nssfEmployer: number
  housingLevyEmployer: number
  employerPayrollCostEstimate: number
  assumptions: string[]
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function calculatePaye(taxablePay: number) {
  let remaining = Math.max(0, taxablePay)
  let tax = 0
  for (const band of kenyaPayrollRuleSet.payeBands) {
    const bandPay = Math.min(remaining, band.width)
    tax += bandPay * band.rate
    remaining -= bandPay
    if (remaining <= 0) break
  }
  return roundMoney(tax)
}

export function estimateKenyaPayroll(input: KenyaPayrollEstimateInput): KenyaPayrollEstimate {
  const gross = roundMoney(input.grossMonthlyPay)
  const otherDeductions = roundMoney(input.otherTaxableDeductions ?? 0)
  const otherReliefs = roundMoney(input.otherTaxReliefs ?? 0)
  const { nssf, shif, housingLevy, personalRelief } = kenyaPayrollRuleSet
  const pensionablePay = Math.max(0, Math.min(gross, nssf.upperEarningsLimit))
  const nssfEmployee = roundMoney(pensionablePay * nssf.rate)
  const shifEmployee = gross > 0 ? roundMoney(Math.max(shif.minimum, gross * shif.rate)) : 0
  const housingLevyEmployee = roundMoney(gross * housingLevy.employeeRate)
  const nssfEmployer = roundMoney(pensionablePay * kenyaPayrollRuleSet.nssfEmployerRate)
  const housingLevyEmployer = roundMoney(gross * housingLevy.employerRate)
  const taxablePayEstimate = roundMoney(Math.max(0, gross - nssfEmployee - shifEmployee - housingLevyEmployee - otherDeductions))
  const payeBeforeRelief = calculatePaye(taxablePayEstimate)
  const appliedPersonalRelief = Math.min(personalRelief, payeBeforeRelief)
  const payeEstimate = roundMoney(Math.max(0, payeBeforeRelief - appliedPersonalRelief - otherReliefs))
  const netPayEstimate = roundMoney(gross - nssfEmployee - shifEmployee - housingLevyEmployee - payeEstimate)

  return {
    ruleSet: kenyaPayrollRuleSet.id,
    effectiveFrom: kenyaPayrollRuleSet.effectiveFrom,
    reviewRequired: true,
    grossMonthlyPay: gross,
    nssfEmployee,
    shifEmployee,
    housingLevyEmployee,
    taxablePayEstimate,
    payeBeforeRelief,
    personalRelief: appliedPersonalRelief,
    otherTaxReliefs: otherReliefs,
    payeEstimate,
    netPayEstimate,
    nssfEmployer,
    housingLevyEmployer,
    employerPayrollCostEstimate: roundMoney(gross + nssfEmployer + housingLevyEmployer),
    assumptions: [
      'Uses the KE-2026-01 rule snapshot and requires review by a qualified Kenyan payroll/tax professional before payroll or filing use.',
      'Gross monthly pay is treated as pensionable pay for NSSF and gross monthly salary for SHIF and Affordable Housing Levy.',
      'Taxable pay estimate deducts employee NSSF, SHIF, employee Affordable Housing Levy, and any caller-supplied other allowable deductions before PAYE bands.',
      'Applies resident monthly PAYE bands and personal relief; non-resident treatment and individual-specific relief eligibility are not inferred.',
      'Employer cost estimate includes only gross pay, employer NSSF, and employer Affordable Housing Levy; it excludes other employer costs and levies.',
      'This calculation is an estimate only. It does not persist payroll data or submit statutory returns/payments.',
    ],
  }
}