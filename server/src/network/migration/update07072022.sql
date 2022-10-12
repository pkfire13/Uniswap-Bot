/* rename contractAddress to traderContractAddress*/
ALTER TABLE network 
RENAME COLUMN "contractAddress" TO "traderContractAddress";

/* add column managerContractAddress*/
ALTER TABLE network 
ADD COLUMN "managerContractAddress" VARCHAR NOT NULL;

/* insert manager contract address where chainId = respective chain ID*/
UPDATE network SET "managercontractaddress" = '0x3C611CB92EB82f0A26660622ED8AB2D0c2ab4A24' where "chainId" = 137;
UPDATE network SET "managercontractaddress" = '0xf81d96D23035E6c4A08d1209b4419be6B32b43c1' where "chainId" = 56;


