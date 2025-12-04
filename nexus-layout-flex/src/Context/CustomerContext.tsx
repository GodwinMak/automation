import React, {
  createContext,
  useReducer,
  useEffect,
  ReactNode,
  Dispatch,
} from "react";

type CustomerState = {
  customerData: any | null; // change "any" to your customer data type if you have one
}

type CustomerAction =
  | { type: "SET_CUSTOMER_DATA"; payload: any }
  | { type: "CLEAR_CUSTOMER_DATA" };

type CustomerContextType = {
  state: CustomerState;
  dispatch: Dispatch<CustomerAction>;
};

const initialState: CustomerState = {
  customerData: null,
};

// ✅ strongly typed context
const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

const customerReducer = (state: CustomerState, action: CustomerAction): CustomerState => {
  switch (action.type) {
    case "SET_CUSTOMER_DATA":
      return { ...state, customerData: action.payload };
    case "CLEAR_CUSTOMER_DATA":
      return { ...state, customerData: null };
    default:
      return state;
  }
};

const CustomerProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(customerReducer, initialState);

  return (
    <CustomerContext.Provider value={{ state, dispatch }}>
      {children}
    </CustomerContext.Provider>
  );
};

export { CustomerContext, CustomerProvider };