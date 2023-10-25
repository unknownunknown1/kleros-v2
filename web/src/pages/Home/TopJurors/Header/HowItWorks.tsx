import React from "react";
import styled from "styled-components";
import BookOpenIcon from "tsx:assets/svgs/icons/book-open.svg";

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    color: ${({ theme }) => theme.primaryBlue};
  }

  svg {
    path {
      fill: ${({ theme }) => theme.primaryBlue};
    }
  }
`;

const Rewards: React.FC = () => (
  <Container>
    <BookOpenIcon />
    <label> How it works </label>
  </Container>
);
export default Rewards;