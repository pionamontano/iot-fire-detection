const fs = require('fs');
const path = 'src/pages/responder/ResponderDashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

// fix imports
code = code.replace(
  `import React, { useEffect, useState, useCallback } from 'react';`,
  `import React, { useEffect, useState, useCallback, useMemo } from 'react';`
);

// replace React.useMemo with useMemo
code = code.replace(/React\.useMemo/g, 'useMemo');

// fix missing pulse on highlight class
code = code.replace(
  `highlightClass={activeAlarmCount > 0 ? "ring-2 ring-red-500 bg-red-50" : ""}`,
  `highlightClass={activeAlarmCount > 0 ? "ring-2 ring-red-500 bg-red-50 animate-pulse" : ""}`
);

fs.writeFileSync(path, code);
