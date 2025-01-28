export function transformCommaSeperatedName(name: string) {
  if (name.includes(",")) {
    try {
      const split = name.split(",")
      return `${split[1].slice(1, split[1].length)} ${split[0]}`
    } catch (e) {
      return name;
    }
  }
  return name;
}
