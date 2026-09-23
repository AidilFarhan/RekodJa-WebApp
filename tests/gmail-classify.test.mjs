import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail, extractEmailDetails, isApplicationEmail } from '../src/lib/gmail/scan-core.ts';

/*
 * Classifier regression tests.
 *
 * The UOB fixture is a real Workday auto-acknowledgement whose classification
 * was once 'Replied' instead of 'Applied'. Today that whole family is noise:
 * a thanks phrase plus follow-up boilerplate ("will reach out", "not
 * monitored", "track your progress") is discarded before classification.
 */

const UOB_SUBJECT = 'Candidate Application is Sent';
const UOB_BODY = [
  "Thank you for your interest in UOB. We're glad you took the time to apply and consider a career with us.",
  '',
  'What happens next:',
  '- Our recruitment team will review your application against the role requirements',
  '- If your profile is shortlisted, a recruiter will reach out to discuss next steps',
].join('\n');

test('UOB auto-acknowledgement is discarded as noise', () => {
  assert.equal(isApplicationEmail(UOB_SUBJECT, UOB_BODY), false);
  assert.equal(classifyEmail(UOB_SUBJECT, UOB_BODY), '');
});

test('Workday "track your progress / not monitored" mailboxes are discarded', () => {
  assert.equal(isApplicationEmail('Thank you for your application', 'Thank you for your application to JR2984 Executive. Please view the external career site to track your job application progress. This email box is not monitored. Please do not reply to this message.', 'sdguthrie@myworkday.com'), false);
});

test('aviation campaign and PERKESO mass invites are discarded', () => {
  assert.equal(isApplicationEmail('Jemputan Rasmi Temu Duga Kerjaya Penerbangan', 'Peluang kerjaya dalam industri penerbangan kini dibuka kepada calon tanpa pengalaman. Pilih lokasi temu duga berhampiran anda.', 'Pegawai ACM <aviationcareermalaysia@yegmy.com>'), false);
  assert.equal(isApplicationEmail('Jemputan', 'Kami dengan sukacitanya menjemput anda untuk menyertai Program Lindung Kerjaya MYFutureJobs, yang menghimpunkan pelbagai majikan daripada pelbagai sektor.', 'Amirah Binti Alim <amirah.alim@perkeso.gov.my>'), false);
});

test('Indeed Apply submission confirmation is discarded', () => {
  assert.equal(isApplicationEmail('Your application', 'Your application has been submitted. Good luck!', 'Indeed Apply <indeedapply@indeed.com>'), false);
});

test('"only shortlisted candidates will be contacted" acks are discarded', () => {
  assert.equal(isApplicationEmail('FSTEP Batch 31 Application', 'Congratulations on successfully submitting your application. Due to the high volume of applications received, we regret that we are unable to provide individual updates on application status. Only shortlisted candidates will be contacted for interviews, no later than 15 September 2026.', 'FSTEP <step@asianbankingschool.com>'), false);
});

test('conditional-fit promises (Citi, Maxis) are discarded', () => {
  assert.equal(isApplicationEmail('Thank you for applying', "Thank you for taking the time to apply for the role. Once we review your application, if we feel you are a good fit for this role, we'll reach out to you with information about next steps. Top candidates will be required to provide a photo during the interview process.", 'Citi Human Resources <citi@myworkday.com>'), false);
  assert.equal(isApplicationEmail('Thank you for your application', 'Thank you for your application and interest in Maxis! We will review and assess your profile. We would love to have a chat with you further and will be sending you an invitation to a digital interview should there be a good fit.', 'workday maxis.com <maxine@myworkday.com>'), false);
});

test('Shopee Affiliate approvals are discarded', () => {
  assert.equal(isApplicationEmail('Congratulations', 'Dear nayocat, Congratulations — your application for the Shopee Affiliate Program has been APPROVED!', 'Shopee Affiliate Malaysia <affiliate@newsletter.shopee.com.my>'), false);
});

test('a future-tense "will reach out" promise alone does not make a reply', () => {
  assert.notEqual(classifyEmail('Update', 'If shortlisted, a recruiter will reach out to you.'), 'Replied');
});

test('a genuine recruiter reply is still Replied', () => {
  // Note: the 'Replied' rule matches the exact phrase "reach out" or
  // "confirmation". "reaching out" does NOT match it, which is a pre-existing
  // narrowness this change does not address.
  assert.equal(classifyEmail('Your application', 'We wanted to reach out to you regarding your application.'), 'Replied');
  assert.equal(classifyEmail('Your application', 'This is a confirmation that your details are on file.'), 'Replied');
});

test('an acknowledgement phrased as "thanks for applying" is Applied', () => {
  assert.equal(classifyEmail('Thanks for applying', 'We received your details.'), 'Applied');
});

// Precedence guards: widening the 'Applied' branch must not steal these.
test('a rejection that opens with "thank you for your interest" is still Rejected', () => {
  assert.equal(classifyEmail('Your application', 'Thank you for your interest. We regret to inform you that you were not successful.'), 'Rejected');
});

test('an interview invitation that thanks the candidate is still Interview', () => {
  assert.equal(classifyEmail('Interview invitation', 'Thank you for your interest. We would like to invite you to an interview.'), 'Interview');
});

test('an offer that thanks the candidate is still Offer', () => {
  assert.equal(classifyEmail('Good news', 'Thank you for your interest. We are pleased to offer you the position.'), 'Offer');
});

test('an expired posting with no response is Ghosted', () => {
  assert.equal(
    classifyEmail('Update on your application', 'This posting has expired and is no longer taking applications.'),
    'Ghosted',
  );
});

// JobStreet sends expiry notices in one fixed shape: "the X job you applied
// for at Y has expired and is no longer taking applications." Real bodies carry
// Windows \r\n line endings, so extraction must cross them.
const JOBSTREET_EXPIRED =
  'Hi Aidil Farhan, the NEXTGEN Graduate Associate job you applied for at HLMG\r\nManagement Co Sdn Bhd has expired and is no longer taking applications.\r\n%%str_to_replace_open_tracking%%';

test('JobStreet expiry notice extracts role and company', () => {
  const details = extractEmailDetails('', JOBSTREET_EXPIRED, 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.company, 'HLMG Management Co Sdn Bhd');
  assert.equal(details.role, 'NEXTGEN Graduate Associate');
});

test('JobStreet expiry with a line break inside "applied for" still extracts', () => {
  const text = 'Hi Aidil Farhan, the Executive (Corporate Affairs & Stakeholder) job you applied\r\nfor at TNB Engineering Corporation Sdn. Bhd. has expired and is no longer taking applications.';
  const details = extractEmailDetails('', text, 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.company, 'TNB Engineering Corporation Sdn. Bhd');
  assert.equal(details.role, 'Executive (Corporate Affairs & Stakeholder)');
});

test('JobStreet role keeps a location comma', () => {
  const text = 'Hi Aidil Farhan, the Client Engagement Executive, Puchong job you applied for at\r\nHSBC Bank Malaysia Berhad has expired and is no longer taking applications.';
  const details = extractEmailDetails('', text, 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.company, 'HSBC Bank Malaysia Berhad');
  assert.equal(details.role, 'Client Engagement Executive, Puchong');
});

test('JobStreet role spanning a line break still extracts', () => {
  const text = 'Hi Aidil Farhan, the Data Center Warehouse Executive (Fresh Grad Welcomed!\r\nUrgent Hiring) job you applied for at TITANICOM TECH LIMITED has expired and is no longer taking applications.';
  const details = extractEmailDetails('', text, 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.company, 'TITANICOM TECH LIMITED');
  assert.equal(details.role, 'Data Center Warehouse Executive (Fresh Grad Welcomed! Urgent Hiring)');
});

test('JobStreet expiry notice is Ghosted', () => {
  assert.equal(classifyEmail('', JOBSTREET_EXPIRED), 'Ghosted');
});

test('expiry without plural "applications" is still Ghosted', () => {
  assert.equal(classifyEmail('Update on your application', 'This posting has expired and is no longer taking application.'), 'Ghosted');
});

test('a bare "at X has expired" names the company', () => {
  const details = extractEmailDetails('', 'Hi Aidil Farhan, your application at\r\nHLMG Management Co Sdn Bhd has expired.', 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.company, 'HLMG Management Co Sdn Bhd');
});

test('"applying to our graduate program" extracts no company', () => {
  const details = extractEmailDetails('', 'Thank you for applying to our graduate program. We are excited about your profile.', 'Talent Team <talent@example.com>');
  assert.equal(details.company, '');
});

// LinkedIn confirms with "Your application was sent to X", then puts the role
// on the next non-empty line. The word "confirmation" in these emails must
// not classify them as Replied.
const LINKEDIN_SENT =
  'Your application was sent to TikTok\r\n\r\nSearch Operation Quality Assurance Associate - Evaluation & Investigation\r\nTikTok\r\nKuala Lumpur\r\nView job: https://www.linkedin.com/comm/jobs/view/446160866/';

test('LinkedIn "application was sent" extracts company and next-line role', () => {
  const details = extractEmailDetails('Your application confirmation', LINKEDIN_SENT, 'LinkedIn <jobs-noreply@linkedin.com>');
  assert.equal(details.company, 'TikTok');
  assert.equal(details.role, 'Search Operation Quality Assurance Associate - Evaluation & Investigation');
});

test('LinkedIn "application was sent" is Applied, not Replied', () => {
  assert.equal(classifyEmail('Your application confirmation', LINKEDIN_SENT), 'Applied');
});

// JobStreet confirms submissions with "your application for X was successfully
// submitted to Y".
const JOBSTREET_SUBMITTED =
  'Hi Aidil Farhan, your application for HR Management Trainee was successfully submitted to J&T EXPRESS (MALAYSIA) SDN. BHD.';

test('JobStreet "submitted to" notice extracts role and company', () => {
  const details = extractEmailDetails('', JOBSTREET_SUBMITTED, 'Jobstreet Applications <noreply@e.jobstreet.com>');
  assert.equal(details.role, 'HR Management Trainee');
  assert.equal(details.company, 'J&T EXPRESS (MALAYSIA) SDN. BHD');
});

test('"successfully submitted" classifies Applied', () => {
  assert.equal(classifyEmail('Application received', JOBSTREET_SUBMITTED), 'Applied');
});

test('viewed/received notices are discarded as noise', () => {
  assert.equal(isApplicationEmail('', 'Ipsos Sdn Bhd has viewed your application for Research Trainee (Graduate Programme)', 'Jobstreet Applications <noreply@e.jobstreet.com>'), false);
  assert.equal(isApplicationEmail('', 'We have received your application.', 'Jobstreet Applications <noreply@e.jobstreet.com>'), false);
  assert.equal(isApplicationEmail('', "We've received your application.", 'Jobstreet Applications <noreply@e.jobstreet.com>'), false);
});

test('a viewed notice that also invites to an interview is kept', () => {
  assert.equal(isApplicationEmail('Interview invitation', 'Ipsos Sdn Bhd has viewed your application and would like to invite you to an interview.', 'Jobstreet Applications <noreply@e.jobstreet.com>'), true);
});

test('thanks + "we will contact you" acknowledgements are discarded', () => {
  assert.equal(isApplicationEmail('Thanks for applying', 'Thanks for applying to our graduate program. We will contact you soon.'), false);
  assert.equal(isApplicationEmail('Your application', 'Thank you for your interest. We will contact you if shortlisted.'), false);
});

test('thanks + interview scheduling is still kept', () => {
  assert.equal(isApplicationEmail('Your application', 'Thank you for your interest. We will contact you to schedule an interview.'), true);
});

test('"is unlikely to progress further" is Ghosted', () => {
  assert.equal(classifyEmail('Your application', 'Your application is unlikely to progress further.'), 'Ghosted');
});

// Malay, which the extension's keyword lists already supported.
test('Malay keywords still classify', () => {
  assert.equal(classifyEmail('Permohonan', 'Maaf, permohonan anda tidak berjaya.'), 'Rejected');
  assert.equal(classifyEmail('Temuduga', 'Kami ingin menjemput anda untuk sesi temuduga.'), 'Interview');
  assert.equal(classifyEmail('Tawaran', 'Ini tawaran jawatan daripada kami.'), 'Offer');
});

test('unrelated email is not an application email', () => {
  assert.equal(isApplicationEmail('Job alerts for you', 'New jobs matching your profile. Apply now.'), false);
});

test('an unrelated non-application email classifies as empty', () => {
  assert.equal(classifyEmail('Your monthly statement', 'Please review your account statement.'), '');
});

test('a loan application is excluded by the noise filter', () => {
  assert.equal(isApplicationEmail('Loan application', 'Your loan application is approved.'), false);
});
