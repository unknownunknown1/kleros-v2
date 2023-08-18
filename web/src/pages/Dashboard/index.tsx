import React, { useState } from "react";
import styled from "styled-components";
import { useAccount } from "wagmi";
import { DisputeDetailsFragment, useMyCasesQuery } from "queries/useCasesQuery";
import { useUserQuery } from "queries/useUser";
import JurorInfo from "./JurorInfo";
import Courts from "./Courts";
import CasesDisplay from "components/CasesDisplay";
import ConnectWallet from "components/ConnectWallet";

const Container = styled.div`
  width: 100%;
  min-height: calc(100vh - 144px);
  background-color: ${({ theme }) => theme.lightBackground};
  padding: 32px;
`;

const StyledCasesDisplay = styled(CasesDisplay)`
  margin-top: 64px;
`;

const ConnectWalletContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: ${({ theme }) => theme.primaryText};
`;

const Dashboard: React.FC = () => {
  const { isConnected, address } = useAccount();
  const [currentPage, setCurrentPage] = useState(1);
  const casesPerPage = 3;
  const { data: disputesData } = useMyCasesQuery(address, casesPerPage * (currentPage - 1));
  const { data: userData } = useUserQuery(address);

  return (
    <Container>
      {isConnected ? (
        <>
          <JurorInfo />
          <Courts />
          <StyledCasesDisplay
            title="My Cases"
            disputes={disputesData?.user?.disputes as DisputeDetailsFragment[]}
            numberDisputes={userData?.user?.totalDisputes}
            numberClosedDisputes={userData?.user?.totalResolvedDisputes}
            {...{ currentPage, setCurrentPage, casesPerPage }}
          />
        </>
      ) : (
        <ConnectWalletContainer>
          To see your dashboard, connect first
          <hr />
          <ConnectWallet />
        </ConnectWalletContainer>
      )}
    </Container>
  );
};

export default Dashboard;
