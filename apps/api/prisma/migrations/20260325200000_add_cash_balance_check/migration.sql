-- Prevent account cash balance from going negative due to race conditions
ALTER TABLE "Account" ADD CONSTRAINT "Account_cashBalance_non_negative" CHECK ("cashBalance" >= 0);
