import { useState } from "react";
import { AuthPage } from "./pages/AuthPage";
import { GroupFormPage } from "./pages/GroupFormPage";
import { HomePage } from "./pages/HomePage";
import type { NavigateFn, PushDirection, Route } from "./types";

export default function App() {
  const [route, setRoute] = useState<Route>("auth");
  const [direction, setDirection] = useState<PushDirection>("none");
  const [transitionKey, setTransitionKey] = useState(0);

  const navigate: NavigateFn = (nextRoute, nextDirection) => {
    setDirection(nextDirection);
    setTransitionKey((key) => key + 1);
    setRoute(nextRoute);
  };

  return (
    <div className="route-viewport">
      <div className={`route route--${direction}`} key={transitionKey}>
        {route === "auth" && <AuthPage onComplete={() => navigate("home", "up")} />}
        {route === "home" && <HomePage navigate={navigate} />}
        {(route === "join" || route === "new") && (
          <GroupFormPage mode={route} onBack={() => navigate("home", "up")} />
        )}
      </div>
    </div>
  );
}
