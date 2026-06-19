type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export const SectionHeading = ({ eyebrow, title, description, align = "left" }: SectionHeadingProps) => (
  <div className={align === "center" ? "mx-auto mb-10 max-w-2xl text-center" : "mb-10 max-w-2xl"}>
    {eyebrow && (
      <span className="kicker mb-4 inline-flex">
        {eyebrow}
      </span>
    )}
    <h2 className="font-head text-3xl font-bold text-foreground uppercase tracking-wide sm:text-4xl">{title}</h2>
    {description && <p className="mt-4 text-base text-muted-foreground font-body normal-case">{description}</p>}
  </div>
);
